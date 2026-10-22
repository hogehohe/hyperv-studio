$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding

function Write-Json([object] $value) {
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $value -Depth 6 -Compress))
    [Console]::Out.Flush()
}

function Write-CloneProgress([string] $phase, [string] $message) {
    Write-Json ([pscustomobject]@{ kind = 'progress'; progress = [pscustomobject]@{ phase = $phase; message = $message } })
}

function Get-CloneLocalPath([string] $path) {
    $fullPath = [IO.Path]::GetFullPath($path).TrimEnd('\')
    if ($fullPath -notmatch '^[A-Za-z]:\\') { throw "複製先にはローカルドライブの絶対パスが必要です: $path" }
    $fullPath
}

function Test-CloneDescendant([string] $path, [string] $root) {
    $fullPath = [IO.Path]::GetFullPath($path).TrimEnd('\')
    $fullRoot = [IO.Path]::GetFullPath($root).TrimEnd('\')
    $fullPath.StartsWith($fullRoot + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Assert-CloneNoReparseAncestors([string] $path) {
    $current = [IO.Path]::GetFullPath($path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "リンクまたはジャンクションを含む複製先は使用できません: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Assert-CloneDirectoryPath([string] $path) {
    Assert-CloneNoReparseAncestors $path
    $current = [IO.Path]::GetFullPath($path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if ($item -isnot [IO.DirectoryInfo]) {
                throw "複製先の親パスがフォルダーではありません: $current"
            }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function New-CloneDirectory([string] $path, [bool] $allowExisting = $false) {
    $target = Get-CloneLocalPath $path
    try {
        Assert-CloneDirectoryPath $target
        if ($allowExisting -and (Test-Path -LiteralPath $target -PathType Container)) { return }
        # No -Force: an existing operation directory must never be reused.
        New-Item -ItemType Directory -Path $target -ErrorAction Stop | Out-Null
        Assert-CloneDirectoryPath $target
    }
    catch { throw "複製先フォルダーを作成できません: $target 。 $($_.Exception.Message)" }
}

function Assert-CloneTree([string] $path, [string] $ownedRoot) {
    $root = Get-CloneLocalPath $ownedRoot
    $target = Get-CloneLocalPath $path
    if ([IO.Path]::GetFileName($root) -notmatch '^hyperv-studio-clone-[0-9a-f]{32}$') {
        throw '複製専用ディレクトリの識別子が正しくありません。'
    }
    if (![string]::Equals($target, $root, [StringComparison]::OrdinalIgnoreCase) -and !(Test-CloneDescendant $target $root)) {
        throw "複製専用ディレクトリの範囲外を操作しようとしました: $target"
    }
    Assert-CloneNoReparseAncestors $target
    if (!(Test-Path -LiteralPath $target -PathType Container)) { return }
    # Walk each directory explicitly; never traverse reparse points before deletion.
    $pending = New-Object 'System.Collections.Generic.Stack[string]'
    $pending.Push($target)
    while ($pending.Count -gt 0) {
        $directory = New-Object IO.DirectoryInfo($pending.Pop())
        foreach ($entry in $directory.EnumerateFileSystemInfos()) {
            if (!(Test-CloneDescendant $entry.FullName $root) -or ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "複製専用ディレクトリに安全に削除できない項目があります: $($entry.FullName)"
            }
            if (($entry.Attributes -band [IO.FileAttributes]::Directory) -ne 0) { $pending.Push($entry.FullName) }
        }
    }
}

function Remove-CloneTree([string] $path, [string] $ownedRoot) {
    Assert-CloneTree $path $ownedRoot
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop }
}

function Assert-CloneSource([object] $source) {
    if ($source.State.ToString() -ne 'Off') { throw '元 VM をシャットダウンして、停止状態にしてから複製してください。' }
    if ($source.IsClustered -or $source.ReplicationMode.ToString() -ne 'None') {
        throw 'クラスタまたはレプリカが設定された VM の複製には対応していません。'
    }
    if ($source.GuestStateIsolationType -and $source.GuestStateIsolationType.ToString() -ne 'Disabled') {
        throw 'ゲスト状態の分離・保護が設定された VM の複製には対応していません。'
    }
    if (@(Get-VMSnapshot -VM $source -ErrorAction Stop).Count -gt 0) {
        throw 'チェックポイントがある VM は複製できません。Hyper-V でチェックポイントを削除し、ディスクの統合完了後に実行してください。'
    }
    $security = Get-VMSecurity -VM $source -ErrorAction Stop
    if ($security.TpmEnabled -or $security.Shielded -or $security.KsdEnabled -or $security.EncryptStateAndVmMigrationTraffic -or $security.BindToHostTpm) {
        throw '仮想 TPM または保護・暗号化が設定された VM の複製には対応していません。'
    }
    if (@(Get-VMFibreChannelHba -VM $source -ErrorAction Stop).Count -gt 0 -or
        @(Get-VMAssignableDevice -VM $source -ErrorAction Stop).Count -gt 0 -or
        @(Get-VMGpuPartitionAdapter -VM $source -ErrorAction Stop).Count -gt 0 -or
        $source.RemoteFxAdapter) {
        throw '物理デバイスや GPU を割り当てた VM の複製には対応していません。'
    }
    if (@($source.ComPorts | Where-Object { $_.Path }).Count -gt 0) {
        throw 'COM ポートの接続先が設定された VM の複製には対応していません。'
    }
    $diskNames = @{}
    foreach ($disk in @(Get-VMHardDiskDrive -VM $source -ErrorAction Stop)) {
        if (!$disk.Path -or $disk.SupportPersistentReservations -or [IO.Path]::GetExtension($disk.Path) -notin @('.vhd', '.vhdx')) {
            throw '物理ディスクまたは共有ディスクを使う VM の複製には対応していません。'
        }
        $vhd = Get-VHD -Path $disk.Path -ErrorAction Stop
        if ($vhd.ParentPath -or $vhd.VhdType.ToString() -eq 'Differencing') {
            throw '差分ディスクを使う VM は複製できません。独立した VHD/VHDX に統合した VM を指定してください。'
        }
        $fileName = [IO.Path]::GetFileName($disk.Path)
        if ($diskNames.ContainsKey($fileName)) { throw '同じファイル名の仮想ディスクが複数ある VM の複製には対応していません。' }
        $diskNames[$fileName] = $true
    }
}

function Invoke-CloneVm([object] $request) {
    Write-CloneProgress 'preparing' '元 VM と保存先を確認しています。'
    $sourceId = [guid]::Parse([string] $request.source_id)
    $source = Get-VM -Id $sourceId -ErrorAction Stop
    $name = ([string] $request.name).Trim()
    if (!$name -or $name.Length -gt 64 -or $name -match '[<>:"/\\|?*\x00-\x1f]' -or $name -match '[. ]$' -or $name -in @('.', '..') -or $name -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)') {
        throw 'VM 名には Windows のファイル名に使用できる 1〜64 文字を指定してください。'
    }
    if (@(Get-VM -ErrorAction Stop | Where-Object { [string]::Equals($_.Name, $name, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) {
        throw "同名の VM '$name' がすでに存在します。"
    }
    Assert-CloneSource $source
    $sourceDiskCount = @(Get-VMHardDiskDrive -VM $source -ErrorAction Stop).Count
    $sourceAdapters = @(Get-OrderedVmNetworkAdapters $source)
    $networkSignature = Get-NetworkSignature $sourceAdapters
    $sourceSwitches = @{}
    foreach ($adapter in $sourceAdapters) {
        if ($request.connect_network -and $adapter.SwitchId -and $adapter.SwitchId -ne [guid]::Empty) {
            $sourceSwitches[(Get-NetworkAdapterKey $adapter)] = Get-VMSwitch -Id $adapter.SwitchId -ErrorAction Stop
        }
    }
    $hasGuest = ![string]::IsNullOrEmpty([string] $request.guest_hostname)
    $seedSource = $null
    $guestMacs = @($request.guest_macs)
    if ($hasGuest) {
        if ([string] $request.guest_hostname -cnotmatch '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$') { throw 'ホスト名の形式が正しくありません。' }
        $seedSource = [string] $request.guest_seed_path
        if (![IO.Path]::IsPathRooted($seedSource) -or [IO.Path]::GetExtension($seedSource) -ine '.iso' -or !(Test-Path -LiteralPath $seedSource -PathType Leaf)) { throw 'OS 設定イメージが見つかりません。' }
        if ($guestMacs.Count -gt 8 -or $guestMacs.Count -ne $sourceAdapters.Count) { throw '複製 VM の MAC アドレス数が一致しません。' }
        $macSet = @{}
        foreach ($mac in $guestMacs) {
            if ([string] $mac -notmatch '^02[0-9a-f]{10}$' -or $macSet.ContainsKey([string] $mac)) { throw '複製 VM の MAC アドレスが正しくありません。' }
            $macSet[[string] $mac] = $true
        }
        $expectedIds = @($request.guest_adapter_ids)
        if ($expectedIds.Count -ne $sourceAdapters.Count) { throw '元 VM のネットワーク構成が取得後に変わりました。' }
        for ($i = 0; $i -lt $expectedIds.Count; $i++) {
            if (![string]::Equals([string] $expectedIds[$i], [string] $sourceAdapters[$i].Id, [StringComparison]::OrdinalIgnoreCase)) { throw '元 VM のネットワーク構成が取得後に変わりました。' }
        }
        Assert-CloneNoReparseAncestors $seedSource
        if ($sourceDiskCount -lt 1) { throw 'OS 自動設定には仮想ディスクが必要です。' }
        $macOwners = @(Get-VM -ErrorAction Stop | Get-VMNetworkAdapter -ErrorAction Stop | Where-Object { $macSet.ContainsKey([string] $_.MacAddress) })
        $macOwners += @(Get-VMNetworkAdapter -ManagementOS -ErrorAction Stop | Where-Object { $macSet.ContainsKey([string] $_.MacAddress) })
        if ($macOwners.Count -gt 0) { throw '複製用 MAC アドレスが既存のアダプターと重複しました。もう一度複製してください。' }
    }
    elseif ($request.guest_seed_path -or $request.guest_macs -or $request.guest_adapter_ids) { throw 'OS 自動設定にはホスト名が必要です。' }
    # Match new VM storage instead of the host-wide defaults. The default
    # ProgramData configuration directory may deny writes to Hyper-V admins.
    $vmBase = Get-CloneLocalPath 'C:\Virtual Machines'
    $vhdBase = $vmBase
    New-CloneDirectory $vmBase $true
    $operationName = 'hyperv-studio-clone-' + [guid]::NewGuid().ToString('N')
    $vmRoot = Join-Path $vmBase $operationName
    $vhdRoot = Join-Path $vhdBase $operationName
    $exportRoot = Join-Path $vmRoot 'export'
    $configRoot = Join-Path $vmRoot 'vm'
    $checkpointRoot = Join-Path $vmRoot 'checkpoints'
    $pagingRoot = Join-Path $vmRoot 'paging'
    if (!(Test-CloneDescendant $vmRoot $vmBase) -or !(Test-CloneDescendant $vhdRoot $vhdBase)) { throw '複製先の範囲を確認できません。' }
    $sameRoot = [string]::Equals($vmRoot, $vhdRoot, [StringComparison]::OrdinalIgnoreCase)
    $createdVmRoot = $false
    $createdVhdRoot = $false
    $importAttempted = $false
    $copy = $null
    try {
        New-CloneDirectory $vmRoot
        $createdVmRoot = $true
        if (!$sameRoot) {
            New-CloneDirectory $vhdRoot
            $createdVhdRoot = $true
        }
        foreach ($directory in @($exportRoot, $configRoot, $checkpointRoot, $pagingRoot)) {
            New-CloneDirectory $directory
        }
        Write-CloneProgress 'exporting' '元 VM の構成と仮想ディスクをコピーしています。'
        Export-VM -VM $source -Path $exportRoot -ErrorAction Stop | Out-Null
        Assert-CloneTree $exportRoot $vmRoot
        $source = Get-VM -Id $sourceId -ErrorAction Stop
        Assert-CloneSource $source
        if ((Get-NetworkSignature @(Get-OrderedVmNetworkAdapters $source)) -ne $networkSignature) { throw 'コピー中に元 VM のネットワーク構成が変わりました。' }
        if (@(Get-VMHardDiskDrive -VM $source -ErrorAction Stop).Count -ne $sourceDiskCount) { throw 'コピー中に元 VM のディスク構成が変わりました。' }
        $configFiles = @(Get-ChildItem -LiteralPath $exportRoot -Recurse -File -Filter ($sourceId.ToString() + '.vmcx') -ErrorAction Stop)
        if ($configFiles.Count -ne 1) { throw 'コピーした VM 構成ファイルを一意に特定できません。' }
        if (!(Test-CloneDescendant $configFiles[0].FullName $exportRoot)) { throw 'コピーした構成ファイルが作業領域の範囲外です。' }

        Write-CloneProgress 'importing' '新しい VM ID と独立した仮想ディスクを作成しています。'
        $importAttempted = $true
        $copy = Import-VM -Path $configFiles[0].FullName -Copy -GenerateNewId -VirtualMachinePath $configRoot -VhdDestinationPath $vhdRoot -SnapshotFilePath $checkpointRoot -SmartPagingFilePath $pagingRoot -ErrorAction Stop
        if (!$copy -or $copy.Id -eq $sourceId -or !(Test-CloneDescendant $copy.ConfigurationLocation $vmRoot)) { throw '複製 VM の ID または構成の保存先を確認できません。' }
        if ($copy.State.ToString() -ne 'Off') { throw '複製 VM が停止状態ではありません。' }
        Write-CloneProgress 'configuring' '複製 VM の名前とネットワークを設定しています。'
        Set-VM -VM $copy -AutomaticStartAction Nothing -ErrorAction Stop | Out-Null
        if (@(Get-VM -ErrorAction Stop | Where-Object { $_.Id -ne $copy.Id -and [string]::Equals($_.Name, $name, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) {
            throw "コピー中に同名の VM '$name' が作成されました。別の名前で複製してください。"
        }
        Rename-VM -VM $copy -NewName $name -ErrorAction Stop | Out-Null
        $copyAdapters = @(Get-OrderedVmNetworkAdapters $copy)
        if ($copyAdapters.Count -ne $sourceAdapters.Count) { throw '複製 VM のネットワーク数が一致しません。' }
        $copyByAdapterId = @{}
        foreach ($adapter in $copyAdapters) {
            $key = Get-NetworkAdapterKey $adapter
            if (!$key -or $copyByAdapterId.ContainsKey($key)) { throw '複製後のアダプターの対応を一意に確認できません。' }
            $copyByAdapterId[$key] = $adapter
        }
        for ($i = 0; $i -lt $sourceAdapters.Count; $i++) {
            $key = Get-NetworkAdapterKey $sourceAdapters[$i]
            if (!$copyByAdapterId.ContainsKey($key)) { throw '元 VM と複製後のアダプター ID の対応を確認できません。' }
            $adapter = $copyByAdapterId[$key]
            if ($hasGuest) { Set-VMNetworkAdapter -VMNetworkAdapter $adapter -StaticMacAddress ([string] $guestMacs[$i]) -ErrorAction Stop | Out-Null }
            else { Set-VMNetworkAdapter -VMNetworkAdapter $adapter -DynamicMacAddress -ErrorAction Stop | Out-Null }
            if (!$request.connect_network) { Disconnect-VMNetworkAdapter -VMNetworkAdapter $adapter -ErrorAction Stop | Out-Null }
            else { Set-NetworkConnection $adapter $sourceSwitches[$key] }
        }
        foreach ($dvd in @(Get-VMDvdDrive -VM $copy -ErrorAction Stop)) {
            if ($dvd.Path) { Set-VMDvdDrive -VMDvdDrive $dvd -Path $null -ErrorAction Stop | Out-Null }
        }
        if ([int] $copy.Generation -eq 1) {
            $floppy = Get-VMFloppyDiskDrive -VM $copy -ErrorAction Stop
            if ($floppy -and $floppy.Path) { Set-VMFloppyDiskDrive -VMFloppyDiskDrive $floppy -Path $null -ErrorAction Stop | Out-Null }
        }
        $copy = Get-VM -Id $copy.Id -ErrorAction Stop
        $copyDisks = @(Get-VMHardDiskDrive -VM $copy -ErrorAction Stop)
        if ($copyDisks.Count -ne $sourceDiskCount) { throw '複製 VM のディスク数が一致しません。' }
        foreach ($disk in $copyDisks) {
            if (!$disk.Path -or !(Test-CloneDescendant $disk.Path $vhdRoot)) { throw '複製 VM のディスクが専用の保存先にありません。' }
            $vhd = Get-VHD -Path $disk.Path -ErrorAction Stop
            if ($vhd.ParentPath -or $vhd.VhdType.ToString() -eq 'Differencing') { throw '複製 VM のディスクに元ディスクへの依存が残っています。' }
        }
        if ($hasGuest) {
            Write-CloneProgress 'configuring' '初回起動用のホスト名・DHCP 設定を接続しています。'
            $seedPath = Join-Path $vmRoot 'guest-seed.iso'
            [IO.File]::Copy($seedSource, $seedPath, $false)
            $icacls = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) 'icacls.exe'
            $vmIdentity = "NT VIRTUAL MACHINE\$($copy.Id)"
            $aclOutput = & $icacls $seedPath '/grant' "$($vmIdentity):(R)" 2>&1
            if ($LASTEXITCODE -ne 0) { throw "OS 設定イメージの読み取り権限を設定できません: $($aclOutput -join ' ')" }
            $dvd = Get-VMDvdDrive -VM $copy -ErrorAction Stop | Select-Object -First 1
            if ($dvd) { Set-VMDvdDrive -VMDvdDrive $dvd -Path $seedPath -ErrorAction Stop | Out-Null }
            else { Add-VMDvdDrive -VM $copy -Path $seedPath -ErrorAction Stop | Out-Null }
            if ([int] $copy.Generation -eq 2) { Set-VMFirmware -VM $copy -FirstBootDevice $copyDisks[0] -ErrorAction Stop | Out-Null }
        }
        if ($copy.State.ToString() -ne 'Off' -or $copy.AutomaticStartAction.ToString() -ne 'Nothing') { throw '複製 VM の停止・自動起動設定を確認できません。' }
        if (!$request.connect_network -and @(Get-VMNetworkAdapter -VM $copy -ErrorAction Stop | Where-Object { $_.SwitchId -and $_.SwitchId -ne [guid]::Empty }).Count -gt 0) { throw '複製 VM のネットワーク切断を確認できません。' }
        Assert-CloneTree $vmRoot $vmRoot
        if (!$sameRoot) { Assert-CloneTree $vhdRoot $vhdRoot }
        Write-CloneProgress 'cleaning' '一時コピーを削除しています。'
        Remove-CloneTree $exportRoot $vmRoot
        Write-CloneProgress 'completed' 'VM の複製が完了しました。'
        Write-Json ([pscustomobject]@{ kind = 'result'; value = (Convert-Vm $copy) })
    }
    catch {
        $failure = $_.Exception.Message
        $cleanupNotes = New-Object 'System.Collections.Generic.List[string]'
        $canDeleteRoots = $true
        if ($importAttempted) {
            try {
                $ownedCopies = @(Get-VM -ErrorAction Stop | Where-Object { $_.Id -ne $sourceId -and (Test-CloneDescendant $_.ConfigurationLocation $vmRoot) })
                foreach ($ownedCopy in $ownedCopies) {
                    if ($ownedCopy.State.ToString() -ne 'Off') { throw "複製 VM '$($ownedCopy.Name)' が稼働中のため保持しました。" }
                    Remove-VM -VM $ownedCopy -Force -ErrorAction Stop
                }
                if ($copy -and $copy.Id -ne $sourceId -and !(Test-CloneDescendant $copy.ConfigurationLocation $vmRoot)) {
                    throw "専用の保存先の外にある VM '$($copy.Name)' は保持しました。"
                }
            }
            catch { $canDeleteRoots = $false; $cleanupNotes.Add($_.Exception.Message) }
        }
        if ($canDeleteRoots) {
            if ($createdVmRoot) {
                try { Remove-CloneTree $vmRoot $vmRoot }
                catch { $cleanupNotes.Add($_.Exception.Message) }
            }
            if ($createdVhdRoot) {
                try { Remove-CloneTree $vhdRoot $vhdRoot }
                catch { $cleanupNotes.Add($_.Exception.Message) }
            }
        }
        if ($cleanupNotes.Count -gt 0) { $failure += " 作業領域を一部保持しました: $vmRoot ; $vhdRoot 。 " + ($cleanupNotes -join ' ') }
        throw $failure
    }
}

function Assert-CreateVmPath([string] $path) {
    $current = [IO.Path]::GetFullPath($path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "リンクまたはジャンクションを含む VM 保存先は使用できません: $current"
            }
            if ($item -isnot [IO.DirectoryInfo]) { throw "VM 保存先の親パスがディレクトリではありません: $current" }
        }
        $parent = [IO.Path]::GetDirectoryName($current)
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Remove-CreateEmptyDirectory([string] $path, [string] $vmPath) {
    $root = 'C:\Virtual Machines'
    $target = [IO.Path]::GetFullPath($path).TrimEnd('\')
    $ownedVmPath = [IO.Path]::GetFullPath($vmPath).TrimEnd('\')
    if (![string]::Equals([IO.Path]::GetDirectoryName($ownedVmPath), $root, [StringComparison]::OrdinalIgnoreCase) -or
        (![string]::Equals($target, $root, [StringComparison]::OrdinalIgnoreCase) -and
         ![string]::Equals($target, $ownedVmPath, [StringComparison]::OrdinalIgnoreCase))) {
        throw '今回作成した VM ディレクトリ以外は削除できません。'
    }
    Assert-CreateVmPath $target
    if (Test-Path -LiteralPath $target -PathType Container) {
        # Never recurse: partial VM files and directories created by other tools remain.
        [IO.Directory]::Delete($target, $false)
    }
}

function Grant-VmIsoReadAccess([object] $vm, [string] $isoPath) {
    $icacls = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) 'icacls.exe'
    $vmIdentity = "NT VIRTUAL MACHINE\$($vm.Id)"
    $aclOutput = & $icacls $isoPath '/grant' "$($vmIdentity):(R)" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "ISOの読み取り権限を設定できません: $($aclOutput -join ' ')" }
}

function Invoke-CreateVm([object] $request) {
    $name = ([string] $request.name).Trim()
    if (!$name -or $name.Length -gt 64 -or $name -match '[<>:"/\\|?*\x00-\x1f\x7f]' -or $name -match '[. ]$' -or $name -in @('.', '..') -or $name -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)') {
        throw 'VM 名には Windows のファイル名に使用できる 1〜64 文字を指定してください。'
    }
    if (@(Get-VM -ErrorAction Stop | Where-Object { [string]::Equals($_.Name, $name, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) {
        throw "同名の VM '$name' がすでに存在します。"
    }
    $version = [version] '12.0'
    $supportedVersions = @(Get-VMHostSupportedVersion -ErrorAction Stop)
    if (@($supportedVersions | Where-Object { [version] $_.Version -eq $version }).Count -eq 0) {
        throw 'この Hyper-V ホストは VM 構成バージョン 12.0 に対応していません。VM は作成されていません。'
    }
    $generation = [int] $request.generation
    $memoryMb = [long] $request.memory_startup_mb
    $diskGb = [long] $request.vhd_size_gb
    $cpuCount = [int] $request.cpu_count
    if ($generation -notin @(1, 2) -or $memoryMb -lt 512 -or $memoryMb -gt 131072 -or $diskGb -lt 8 -or $diskGb -gt 2048 -or $cpuCount -lt 1 -or $cpuCount -gt 64) {
        throw 'VM の世代・メモリ・ディスク容量・vCPU の指定が正しくありません。'
    }
    $root = 'C:\Virtual Machines'
    $vmPath = Join-Path $root $name
    $vhdPath = Join-Path $vmPath ($name + '.vhdx')
    Assert-CreateVmPath $vmPath
    if (Test-Path -LiteralPath $vmPath) {
        throw "VM の保存先がすでに存在します。既存フォルダーやディスクは上書きできません: $vmPath"
    }
    $networkRequests = @()
    if ($null -ne $request.network_adapters) { $networkRequests = @($request.network_adapters) }
    else { $networkRequests = @([pscustomobject]@{ id = $null; switch_name = $request.switch_name }) }
    if ($networkRequests.Count -gt 8) { throw 'ネットワークアダプターは 0〜8 個で指定してください。' }
    $switches = @(Get-VMSwitch -ErrorAction Stop)
    foreach ($entry in $networkRequests) {
        if ($null -ne $entry.id) { throw '新規 VM のアダプターに既存 ID は指定できません。' }
        Resolve-NetworkSwitch $entry.switch_name $switches | Out-Null
    }
    $isoPath = [string] $request.iso_path
    if ($isoPath -and !(Test-Path -LiteralPath $isoPath -PathType Leaf)) { throw "ISO ファイルが見つかりません: $isoPath" }
    $newVmArgs = @{
        Name = $name
        Generation = $generation
        MemoryStartupBytes = $memoryMb * 1MB
        NewVHDPath = $vhdPath
        NewVHDSizeBytes = $diskGb * 1GB
        BootDevice = 'VHD'
        Path = $vmPath
        Version = $version
        ErrorAction = 'Stop'
    }
    $createdDirectories = New-Object 'System.Collections.Generic.List[string]'
    $vm = $null
    try {
        if (!(Test-Path -LiteralPath $root)) {
            New-Item -ItemType Directory -Path $root -ErrorAction Stop | Out-Null
            $createdDirectories.Add($root)
        }
        Assert-CreateVmPath $root
        # No -Force: an existing directory, including one created concurrently, is a collision.
        New-Item -ItemType Directory -Path $vmPath -ErrorAction Stop | Out-Null
        $createdDirectories.Add($vmPath)
        Assert-CreateVmPath $vmPath
        if (Test-Path -LiteralPath $vhdPath) { throw "仮想ディスクがすでに存在します: $vhdPath" }
        $vm = New-VM @newVmArgs
        Set-VMProcessor -VM $vm -Count $cpuCount -ErrorAction Stop | Out-Null
        $initialAdapters = @(Get-OrderedVmNetworkAdapters $vm)
        $createPlan = @()
        for ($i = 0; $i -lt $networkRequests.Count; $i++) {
            $id = if ($i -lt $initialAdapters.Count) { [string] $initialAdapters[$i].Id } else { $null }
            $createPlan += [pscustomobject]@{ id = $id; switch_name = $networkRequests[$i].switch_name }
        }
        Save-NetworkAdapters $vm $createPlan @($initialAdapters | ForEach-Object { [string] $_.Id }) | Out-Null
        if ($isoPath) {
            Grant-VmIsoReadAccess $vm $isoPath
            $dvd = Get-VMDvdDrive -VM $vm -ErrorAction Stop | Select-Object -First 1
            if ($dvd) { Set-VMDvdDrive -VMDvdDrive $dvd -Path $isoPath -ErrorAction Stop | Out-Null }
            else { Add-VMDvdDrive -VM $vm -Path $isoPath -ErrorAction Stop | Out-Null }
            if ($generation -eq 2) {
                if ($request.os_family -eq 'linux') {
                    Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate MicrosoftUEFICertificateAuthority -ErrorAction Stop | Out-Null
                }
                elseif ($request.os_family -eq 'windows') {
                    Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -ErrorAction Stop | Out-Null
                }
            }
        }
        if ($generation -eq 2) {
            $disk = Get-VMHardDiskDrive -VM $vm -ErrorAction Stop | Where-Object { [string]::Equals($_.Path, $vhdPath, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
            if (!$disk) { throw '作成した仮想ディスクを確認できません。' }
            # Move HDD first, then installation media first when present. Each move
            # preserves every other firmware entry, including all network adapters.
            Set-VMFirmware -VM $vm -FirstBootDevice $disk -ErrorAction Stop | Out-Null
            if ($isoPath) {
                $dvd = Get-VMDvdDrive -VM $vm -ErrorAction Stop | Where-Object { [string]::Equals($_.Path, $isoPath, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1
                if (!$dvd) { throw 'インストール ISO を接続した DVD ドライブを確認できません。' }
                Set-VMFirmware -VM $vm -FirstBootDevice $dvd -ErrorAction Stop | Out-Null
            }
        }
        else {
            $startupOrder = if ($isoPath) { @('CD', 'IDE', 'LegacyNetworkAdapter', 'Floppy') } else { @('IDE', 'CD', 'LegacyNetworkAdapter', 'Floppy') }
            Set-VMBios -VM $vm -StartupOrder $startupOrder -ErrorAction Stop | Out-Null
        }
        Get-VM -Id $vm.Id -ErrorAction Stop
    }
    catch {
        if ($vm) { throw "VM '$name' は作成されましたが、追加設定に失敗しました。保存先: $vmPath : $($_.Exception.Message)" }
        $failure = $_.Exception.Message
        for ($i = $createdDirectories.Count - 1; $i -ge 0; $i--) {
            try { Remove-CreateEmptyDirectory $createdDirectories[$i] $vmPath } catch { }
        }
        throw "VM '$name' を作成できませんでした。保存先: $vmPath : $failure"
    }
}

function Get-BootSourceFootprint([object] $vm, [object[]] $rawEntries) {
    Add-Type -AssemblyName System.Management -ErrorAction Stop
    $vmId = ([guid] $vm.Id).ToString('D')
    $computer = @(Get-CimInstance -Namespace 'root\virtualization\v2' -ClassName Msvm_ComputerSystem -Filter "Name='$vmId'" -ErrorAction Stop)
    if ($computer.Count -ne 1) { throw 'VM のファームウェア情報を一意に確認できません。' }
    $settings = @(Get-CimAssociatedInstance -InputObject $computer[0] -Association Msvm_SettingsDefineState -ResultClassName Msvm_VirtualSystemSettingData -ErrorAction Stop)
    if ($settings.Count -ne 1 -or $settings[0].VirtualSystemType -cne 'Microsoft:Hyper-V:System:Realized') { throw '現在の VM ファームウェア情報を確認できません。' }
    $sources = @(Get-CimAssociatedInstance -InputObject $settings[0] -Association Msvm_BootSourceComponent -ResultClassName Msvm_BootSourceSettingData -ErrorAction Stop)
    $references = @($settings[0].BootSourceOrder | Where-Object { $null -ne $_ })
    if ($references.Count -ne $rawEntries.Count) { throw '取得中に起動設定が変わりました。再読み込みしてください。' }
    $pool = @()
    foreach ($source in @($sources | Sort-Object InstanceID)) {
        if (!$source.InstanceID) { throw '起動エントリーの識別子を確認できません。' }
        $pool += [pscustomobject][ordered]@{
            instance_id = [string] $source.InstanceID
            source_type = [int] $source.BootSourceType
            firmware_path = [string] $source.FirmwareDevicePath
            description = [string] $source.BootSourceDescription
            other_location = if ($null -eq $source.OtherLocation) { $null } else { [string] $source.OtherLocation }
            optional_data = if ($null -eq $source.OptionalData) { $null } else { [Convert]::ToBase64String([byte[]] $source.OptionalData) }
        }
    }
    $ordered = @(); $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    for ($i = 0; $i -lt $references.Count; $i++) {
        # Parse local provider references as data; never bind to a supplied server/path.
        $path = New-Object System.Management.ManagementPath([string] $references[$i])
        $namespace = [string] $path.NamespacePath
        $serverPrefix = '\\' + $path.Server + '\'
        if ($namespace.StartsWith($serverPrefix, [StringComparison]::OrdinalIgnoreCase)) { $namespace = $namespace.Substring($serverPrefix.Length) }
        if (!$path.IsInstance -or ![string]::Equals($path.Server, [Environment]::MachineName, [StringComparison]::OrdinalIgnoreCase) -or
            ![string]::Equals($namespace, 'root\virtualization\v2', [StringComparison]::OrdinalIgnoreCase) -or
            ![string]::Equals($path.ClassName, 'Msvm_BootSourceSettingData', [StringComparison]::OrdinalIgnoreCase)) { throw 'ローカル VM の起動エントリーを確認できません。' }
        $matches = @($pool | Where-Object {
            $escaped = $_.instance_id.Replace('\', '\\').Replace('"', '\"')
            $expected = 'Msvm_BootSourceSettingData.InstanceID="' + $escaped + '"'
            [string]::Equals($path.RelativePath, $expected, [StringComparison]::OrdinalIgnoreCase)
        })
        if ($matches.Count -ne 1 -or !$seen.Add($matches[0].instance_id)) { throw '起動エントリーとファームウェア情報の対応を確認できません。' }
        $source = $matches[0]; $entry = $rawEntries[$i]
        if ($source.source_type -ne [int] $entry.BootType -or $source.firmware_path -cne [string] $entry.FirmwarePath -or $source.description -cne [string] $entry.Description) { throw '取得中に起動設定が変わりました。再読み込みしてください。' }
        $ordered += $source
    }
    [pscustomobject]@{ ordered = @($ordered); pool = @($pool) }
}

function Get-BootRevision([string] $vmId, [int] $generation, [object] $secureBoot, [string] $templateName, [string] $templateId, [object[]] $identities, [object[]] $sourcePool) {
    $canonical = [pscustomobject][ordered]@{
        vm_id = $vmId.ToLowerInvariant()
        generation = $generation
        secure_boot = $secureBoot
        template = $templateName
        template_id = $templateId
        entries = @($identities | Where-Object { $null -ne $_ })
        source_pool = @($sourcePool | Where-Object { $null -ne $_ })
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $canonical -Depth 10 -Compress))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Get-VmBootSnapshot([object] $vm) {
    $generation = [int] $vm.Generation
    $secureBoot = $null; $templateName = ''; $templateId = ''
    $views = @(); $identities = @(); $sourcePool = @()
    if ($generation -eq 2) {
        $firmware = Get-VMFirmware -VM $vm -ErrorAction Stop
        if ($firmware.SecureBoot.ToString() -notin @('On', 'Off')) { throw 'セキュアブートの状態を確認できません。' }
        $secureBoot = $firmware.SecureBoot.ToString() -eq 'On'
        $templateName = [string] $firmware.SecureBootTemplate
        $templateId = [string] $firmware.SecureBootTemplateId
        $raw = @($firmware.BootOrder | Where-Object { $null -ne $_ })
        $cim = Get-BootSourceFootprint $vm $raw
        $sourcePool = @($cim.pool)
        for ($i = 0; $i -lt $raw.Count; $i++) {
            $entry = $raw[$i]; $device = $entry.Device
            $deviceType = if ($device) { $device.GetType().Name } else { '' }
            $kind = 'other'; $label = [string] $entry.Description; $detail = [string] $entry.FirmwarePath
            switch ($deviceType) {
                'HardDiskDrive' { $kind = 'disk'; $label = 'ハードディスク'; $detail = [string] $device.Path }
                'DvdDrive' { $kind = 'dvd'; $label = 'DVD ドライブ'; $detail = if ($device.Path) { [string] $device.Path } else { 'メディアなし' } }
                'VMNetworkAdapter' { $kind = 'network'; $label = [string] $device.Name; $detail = if ($device.SwitchName) { [string] $device.SwitchName } else { '未接続' } }
            }
            if ($entry.BootType.ToString() -eq 'File') { $kind = 'file' }
            if (!$label) { $label = if ($kind -eq 'file') { 'UEFI 起動ファイル' } else { '起動エントリー' } }
            $views += [pscustomobject][ordered]@{ id = "boot-$i"; label = $label; kind = $kind; detail = if ($detail) { $detail } else { $null } }
            $identities += [pscustomobject][ordered]@{
                boot_type = $entry.BootType.ToString()
                firmware_path = [string] $entry.FirmwarePath
                description = [string] $entry.Description
                device_type = $deviceType
                device_id = [string] $device.Id
                device_path = [string] $device.Path
                device_name = [string] $device.Name
                mac_address = [string] $device.MacAddress
                switch_id = [string] $device.SwitchId
                switch_name = [string] $device.SwitchName
                controller_type = [string] $device.ControllerType
                controller_number = [string] $device.ControllerNumber
                controller_location = [string] $device.ControllerLocation
                source = $cim.ordered[$i]
            }
        }
    }
    elseif ($generation -eq 1) {
        $bios = Get-VMBios -VM $vm -ErrorAction Stop
        $raw = @($bios.StartupOrder | Where-Object { $null -ne $_ })
        for ($i = 0; $i -lt $raw.Count; $i++) {
            $deviceName = $raw[$i].ToString()
            $kind = 'other'; $label = $deviceName
            switch ($deviceName) {
                'IDE' { $kind = 'disk'; $label = 'IDE ハードディスク' }
                'CD' { $kind = 'dvd'; $label = 'CD / DVD ドライブ' }
                'LegacyNetworkAdapter' { $kind = 'network'; $label = 'レガシ ネットワーク' }
                'Floppy' { $label = 'フロッピー ドライブ' }
            }
            $views += [pscustomobject][ordered]@{ id = "boot-$i"; label = $label; kind = $kind; detail = $null }
            $identities += [pscustomobject][ordered]@{ device = $deviceName }
        }
    }
    else { throw 'この VM の世代の起動設定には対応していません。' }
    $revision = Get-BootRevision -vmId $vm.Id.ToString() -generation $generation -secureBoot $secureBoot -templateName $templateName -templateId $templateId -identities $identities -sourcePool $sourcePool
    [pscustomobject]@{
        view = [pscustomobject][ordered]@{
            vm_id = $vm.Id.ToString(); name = [string] $vm.Name; state = $vm.State.ToString(); generation = $generation
            secure_boot_enabled = $secureBoot
            secure_boot_template = if ($templateName) { $templateName } else { $null }
            boot_entries = @($views); revision = $revision
        }
        raw = @($raw); identities = @($identities); pool = @($sourcePool); template_name = $templateName; template_id = $templateId
    }
}

function Save-VmBootSettings([object] $request) {
    $vmId = [guid]::Parse([string] $request.vm_id)
    if ([string] $request.expected_revision -cnotmatch '^[0-9a-f]{64}$') { throw '取得時の起動設定を確認できません。再読み込みしてください。' }
    if ($null -ne $request.secure_boot_enabled -and $request.secure_boot_enabled -isnot [bool]) { throw 'セキュアブートの指定が正しくありません。' }
    $vm = Get-VM -Id $vmId -ErrorAction Stop
    if ($vm.State.ToString() -ne 'Off') { throw '起動設定を保存する前に VM をシャットダウンしてください。' }
    $snapshot = Get-VmBootSnapshot $vm
    if ($snapshot.view.revision -cne [string] $request.expected_revision) { throw '起動設定が取得後に変わりました。再読み込みしてやり直してください。' }
    if ([int] $vm.Generation -eq 1 -and $null -ne $request.secure_boot_enabled) { throw '第 1 世代 VM はセキュアブートに対応していません。' }
    $requestedOrder = @($request.boot_order)
    if ($requestedOrder.Count -ne $snapshot.raw.Count) { throw '起動エントリーの追加や削除はできません。再読み込みしてください。' }
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    $indices = @()
    foreach ($id in $requestedOrder) {
        if ($id -isnot [string] -or $id -cnotmatch '^boot-(0|[1-9][0-9]*)$' -or $id.Length -gt 9 -or !$seen.Add($id)) { throw '起動エントリーの指定が正しくありません。再読み込みしてください。' }
        $index = [int] $id.Substring(5)
        if ($index -ge $snapshot.raw.Count) { throw 'この VM に存在しない起動エントリーは指定できません。' }
        $indices += $index
    }
    # Re-read configuration after validating the complete permutation. Never stop a VM.
    $freshVm = Get-VM -Id $vmId -ErrorAction Stop
    if ($freshVm.State.ToString() -ne 'Off') { throw '処理中に VM が起動されました。保存していません。' }
    $fresh = Get-VmBootSnapshot $freshVm
    if ($fresh.view.revision -cne $snapshot.view.revision) { throw '保存直前に起動設定が変わりました。再読み込みしてください。' }
    $orderedRaw = @($indices | ForEach-Object { $fresh.raw[$_] })
    $orderedIdentity = @($indices | ForEach-Object { $fresh.identities[$_] })
    $desiredSecureBoot = if ($null -ne $request.secure_boot_enabled) { [bool] $request.secure_boot_enabled } else { $fresh.view.secure_boot_enabled }
    $desiredRevision = Get-BootRevision -vmId $vmId.ToString() -generation ([int] $freshVm.Generation) -secureBoot $desiredSecureBoot -templateName $fresh.template_name -templateId $fresh.template_id -identities $orderedIdentity -sourcePool $fresh.pool
    $lastVm = Get-VM -Id $vmId -ErrorAction Stop
    if ($lastVm.Id -ne $vmId -or $lastVm.State.ToString() -ne 'Off') { throw '処理中に VM の状態が変わりました。保存していません。' }
    try {
        if ([int] $lastVm.Generation -eq 2) {
            $arguments = @{ VM = $lastVm; EnableSecureBoot = if ($desiredSecureBoot) { 'On' } else { 'Off' }; ErrorAction = 'Stop' }
            if ($orderedRaw.Count -gt 0) { $arguments.BootOrder = $orderedRaw }
            # Keep the current template and submit the existing native objects in one call.
            Set-VMFirmware @arguments | Out-Null
        }
        else { Set-VMBios -VM $lastVm -StartupOrder $orderedRaw -ErrorAction Stop | Out-Null }
    }
    catch {
        $failure = $_.Exception.Message
        $detail = '保存後の状態を確認できないため、一部の変更が反映された可能性があります。'
        try {
            $actual = Get-VmBootSnapshot (Get-VM -Id $vmId -ErrorAction Stop)
            $detail = if ($actual.view.revision -ceq $snapshot.view.revision) { '起動設定は変更前と同じ状態です。' } else { '起動設定に変更が反映されています。' }
        }
        catch { }
        throw "起動設定の保存に失敗しました。$detail 再読み込みして現在の設定を確認してください: $failure"
    }
    try { $after = Get-VmBootSnapshot (Get-VM -Id $vmId -ErrorAction Stop) }
    catch { throw "起動設定の保存は実行しましたが、完了を確認できません。再読み込みして現在の設定を確認してください: $($_.Exception.Message)" }
    if ($after.view.revision -cne $desiredRevision) { throw '保存後の起動設定が指定内容と一致しません。再読み込みして現在の設定を確認してください。' }
    $after.view
}

function Normalize-IsoPath([string] $path) {
    if ($path.StartsWith('\\?\UNC\', [StringComparison]::OrdinalIgnoreCase)) { $path = '\\' + $path.Substring(8) }
    elseif ($path.StartsWith('\\?\')) { $path = $path.Substring(4) }
    [IO.Path]::GetFullPath($path)
}

function Get-OrderedVmNetworkAdapters([object] $vm) {
    Get-VMNetworkAdapter -VM $vm -ErrorAction Stop | Sort-Object @{ Expression = { Get-NetworkAdapterKey $_ } }
}

function Get-NetworkAdapterKey([object] $adapter) {
    $id = [string] $adapter.Id
    $separator = $id.LastIndexOf('\')
    $key = if ($separator -ge 0) { $id.Substring($separator + 1) } else { '' }
    $guid = [guid]::Empty
    if (![guid]::TryParse($key, [ref] $guid)) { throw 'ネットワークアダプターの機器 ID を確認できません。' }
    $guid.ToString('D')
}

function Convert-NetworkAdapter([object] $adapter) {
    [pscustomobject][ordered]@{
        id = [string] $adapter.Id
        name = [string] $adapter.Name
        switch_name = if ($adapter.SwitchId -and $adapter.SwitchId -ne [guid]::Empty) { [string] $adapter.SwitchName } else { $null }
        mac_address = [string] $adapter.MacAddress
        is_legacy = [bool] $adapter.IsLegacy
    }
}

function Resolve-NetworkSwitch([object] $switchName, [object[]] $switches) {
    if ($null -eq $switchName) { return $null }
    $name = [string] $switchName
    if ([string]::IsNullOrWhiteSpace($name) -or $name.Length -gt 256 -or $name -match '[\x00-\x1f\x7f]') { throw '仮想スイッチ名が正しくありません。' }
    $matches = @($switches | Where-Object { [string]::Equals($_.Name, $name, [StringComparison]::OrdinalIgnoreCase) })
    if ($matches.Count -ne 1) { throw "仮想スイッチ '$name' が見つかりません。一覧を更新して選び直してください。" }
    $matches[0]
}

function Set-NetworkConnection([object] $adapter, [object] $vmSwitch) {
    if ($vmSwitch) { Connect-VMNetworkAdapter -VMNetworkAdapter $adapter -VMSwitch $vmSwitch -ErrorAction Stop | Out-Null }
    else { Disconnect-VMNetworkAdapter -VMNetworkAdapter $adapter -ErrorAction Stop | Out-Null }
}

function Save-NetworkAdapters([object] $vm, [object[]] $requests, [string[]] $expectedIds) {
    if ($vm.State.ToString() -ne 'Off') { throw 'ネットワークを変更する前に VM をシャットダウンしてください。' }
    if ($requests.Count -gt 8) { throw 'ネットワークアダプターは 0〜8 個で指定してください。' }
    $switches = @(Get-VMSwitch -ErrorAction Stop)
    $original = @(Get-OrderedVmNetworkAdapters $vm)
    $expected = @{}
    foreach ($id in $expectedIds) {
        if (!$id -or $expected.ContainsKey($id)) { throw '取得時のネットワーク構成が正しくありません。一覧を更新してください。' }
        $expected[$id] = $true
    }
    if ($expected.Count -ne $original.Count -or @($original | Where-Object { !$expected.ContainsKey([string] $_.Id) }).Count -gt 0) { throw 'ネットワーク構成が取得後に変わりました。一覧を更新してやり直してください。' }
    $originalById = @{}
    $oldSwitches = @{}
    foreach ($adapter in $original) {
        $originalById[[string] $adapter.Id] = $adapter
        $oldSwitches[[string] $adapter.Id] = @($switches | Where-Object { $_.Id -eq $adapter.SwitchId }) | Select-Object -First 1
    }
    $seen = @{}
    $plan = @()
    foreach ($request in $requests) {
        $id = [string] $request.id
        if ($id) {
            if (!$originalById.ContainsKey($id)) { throw '指定されたアダプターはこの VM に存在しません。一覧を更新してください。' }
            if ($seen.ContainsKey($id)) { throw '同じネットワークアダプターが複数指定されています。' }
            $seen[$id] = $true
        }
        elseif ($null -ne $request.id) { throw 'ネットワークアダプター ID が正しくありません。' }
        $plan += [pscustomobject]@{ id = $id; vm_switch = (Resolve-NetworkSwitch $request.switch_name $switches) }
    }
    $remove = @($original | Where-Object { !$seen.ContainsKey([string] $_.Id) })
    $added = New-Object 'System.Collections.Generic.List[object]'
    $updated = New-Object 'System.Collections.Generic.List[object]'
    $removed = New-Object 'System.Collections.Generic.List[string]'
    try {
        if ((Get-VM -Id $vm.Id -ErrorAction Stop).State.ToString() -ne 'Off') { throw '処理中に VM が起動されました。' }
        foreach ($entry in $plan) {
            if ((Get-VM -Id $vm.Id -ErrorAction Stop).State.ToString() -ne 'Off') { throw '処理中に VM が起動されました。' }
            if ($entry.id) {
                $adapter = $originalById[$entry.id]
                $updated.Add($adapter)
                Set-NetworkConnection $adapter $entry.vm_switch
            }
            else {
                $adapter = Add-VMNetworkAdapter -VM $vm -Name ('ネットワーク ' + [guid]::NewGuid().ToString('N').Substring(0, 6)) -DynamicMacAddress -Passthru -ErrorAction Stop
                $added.Add($adapter)
                Set-NetworkConnection $adapter $entry.vm_switch
            }
        }
        # Delete last: retained adapters keep their IDs and advanced settings.
        foreach ($adapter in $remove) {
            if ((Get-VM -Id $vm.Id -ErrorAction Stop).State.ToString() -ne 'Off') { throw '処理中に VM が起動されました。' }
            Remove-VMNetworkAdapter -VMNetworkAdapter $adapter -ErrorAction Stop
            $removed.Add([string] $adapter.Id)
        }
        @(Get-OrderedVmNetworkAdapters $vm | ForEach-Object { Convert-NetworkAdapter $_ })
    }
    catch {
        $failure = $_.Exception.Message
        $rollback = New-Object 'System.Collections.Generic.List[string]'
        $canRollback = $false
        try { $canRollback = (Get-VM -Id $vm.Id -ErrorAction Stop).State.ToString() -eq 'Off' }
        catch { $rollback.Add($_.Exception.Message) }
        if ($canRollback) {
            foreach ($adapter in $added) {
                try { Remove-VMNetworkAdapter -VMNetworkAdapter $adapter -ErrorAction Stop }
                catch { $rollback.Add($_.Exception.Message) }
            }
            foreach ($adapter in $updated) {
                try { Set-NetworkConnection $adapter $oldSwitches[[string] $adapter.Id] }
                catch { $rollback.Add($_.Exception.Message) }
            }
        }
        else { $rollback.Add('VM が稼働中のため追加の変更を中止しました。') }
        if ($removed.Count -gt 0) { $failure += ' 一部のアダプターは削除済みです。削除された ID: ' + ($removed -join ', ') + '。再読み込みして現在の構成を確認してください。' }
        elseif ($rollback.Count -eq 0) { $failure += ' 接続先と追加アダプターの変更は元に戻しました。' }
        if ($rollback.Count -gt 0) { $failure += ' 元に戻せなかった変更があります: ' + ($rollback -join ' ') + '。再読み込みして現在の構成を確認してください。' }
        throw $failure
    }
}

function Get-NetworkSignature([object[]] $adapters) {
    ConvertTo-Json -InputObject @($adapters | ForEach-Object {
        [pscustomobject]@{ id = [string] $_.Id; adapter_id = (Get-NetworkAdapterKey $_); name = [string] $_.Name; switch_id = [string] $_.SwitchId; mac = [string] $_.MacAddress; legacy = [bool] $_.IsLegacy }
    }) -Depth 4 -Compress
}

function Get-DeleteDiskPaths([object[]] $drives) {
    @($drives | Where-Object { $_.Path } | ForEach-Object { Normalize-IsoPath ([string] $_.Path) } | Sort-Object -Unique)
}

function Get-DeleteDiskIdentity([string] $path) {
    if (!('HyperVStudio.DiskIdentity' -as [type])) {
        Add-Type -ErrorAction Stop -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace HyperVStudio {
    public static class DiskIdentity {
        [StructLayout(LayoutKind.Sequential)]
        private struct FileIdInfo { public ulong Volume; public ulong Low; public ulong High; }
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, out FileIdInfo info, uint size);
        public static string Get(string path) {
            using (SafeFileHandle handle = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                FileIdInfo info;
                if (!GetFileInformationByHandleEx(handle, 18, out info, 24)) throw new Win32Exception(Marshal.GetLastWin32Error());
                if (info.Volume == 0 || (info.Low == 0 && info.High == 0)) throw new InvalidOperationException("Unknown file identity");
                return info.Volume.ToString("X16") + ":" + info.Low.ToString("X16") + info.High.ToString("X16");
            }
        }
    }
}
'@
    }
    [HyperVStudio.DiskIdentity]::Get($path)
}

function Assert-LocalReferencePath([string] $path) {
    $raw = $path
    if ($raw.StartsWith('\\?\')) { $raw = $raw.Substring(4) }
    if ($raw -notmatch '^[A-Za-z]:[\\/]') { throw "別 VM の非ローカルディスクの所有関係を確認できません: $path" }
    $current = [IO.Path]::GetFullPath($raw)
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "別 VM のリンク経由のディスクの所有関係を確認できません: $path" }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Assert-DeleteDiskPath([string] $path) {
    $raw = $path
    if ($raw.StartsWith('\\?\')) { $raw = $raw.Substring(4) }
    if ($raw -notmatch '^[A-Za-z]:[\\/]') { throw "ローカル絶対パス以外のディスクは削除できません: $path" }
    $full = [IO.Path]::GetFullPath($raw)
    if ([IO.Path]::GetExtension($full) -notin @('.vhd', '.vhdx')) { throw "独立した VHD/VHDX 以外は削除できません: $path" }
    $entry = Get-Item -LiteralPath $full -Force -ErrorAction Stop
    if (!($entry -is [IO.FileInfo]) -or ($entry.Attributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint -bor [IO.FileAttributes]::Device -bor [IO.FileAttributes]::ReadOnly)) -ne 0) {
        throw "通常の書き込み可能なディスクファイルではありません: $path"
    }
    $current = $full
    while ($current) {
        $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "リンクまたはジャンクションを含むディスクは削除できません: $path" }
        $current = [IO.Path]::GetDirectoryName($current)
    }
}

function Assert-DeleteDiskFile([string] $path) {
    Assert-DeleteDiskPath $path
    $vhd = Get-VHD -Path $path -ErrorAction Stop
    if ($vhd.VhdFormat.ToString() -notin @('VHD', 'VHDX') -or $vhd.VhdType.ToString() -notin @('Fixed', 'Dynamic') -or $vhd.ParentPath) { throw "差分ディスクや特殊形式のディスクは削除できません: $path" }
    if ($vhd.Attached) { throw "マウントまたは使用中のディスクは削除できません: $path" }
    $diskImage = Get-DiskImage -ImagePath $path -ErrorAction Stop
    if (!$diskImage) { throw "ホストのディスク接続状態を確認できません: $path" }
    if ($diskImage.Attached) { throw "ホストにマウント中のディスクは削除できません: $path" }
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    $stream.Dispose()
}

function Assert-NoOtherDiskReferences([string[]] $paths, [guid] $excludedId) {
    $targets = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    $identities = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
    foreach ($path in $paths) { $targets.Add((Normalize-IsoPath $path)) | Out-Null }
    foreach ($path in $paths) { $identities.Add((Get-DeleteDiskIdentity $path)) | Out-Null }
    foreach ($owner in @(Get-VM -ErrorAction Stop)) {
        if ($owner.Id -eq $excludedId) { continue }
        $references = @(Get-VMHardDiskDrive -VM $owner -ErrorAction Stop)
        foreach ($snapshot in @(Get-VMSnapshot -VM $owner -ErrorAction Stop)) {
            $references += @(Get-VMHardDiskDrive -VMSnapshot $snapshot -ErrorAction Stop)
        }
        foreach ($disk in $references) {
            if (!$disk.Path) { continue }
            $current = Normalize-IsoPath ([string] $disk.Path)
            $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
            while ($current) {
                if ($targets.Contains($current)) { throw "別の VM またはチェックポイント '$($owner.Name)' がディスクを参照しています: $current" }
                if (!$seen.Add($current) -or $seen.Count -gt 256) { throw "ディスクの親子関係を確認できません: $current" }
                Assert-LocalReferencePath $current
                if ($identities.Contains((Get-DeleteDiskIdentity $current))) { throw "別名のパスで別の VM またはチェックポイント '$($owner.Name)' がディスクを参照しています: $current" }
                $vhd = Get-VHD -Path $current -ErrorAction Stop
                $current = if ($vhd.ParentPath) { Normalize-IsoPath ([string] $vhd.ParentPath) } else { $null }
            }
        }
    }
}

function Assert-DeleteDisks([object] $vm, [object[]] $drives, [string[]] $paths) {
    if ($paths.Count -eq 0) { throw '削除対象の仮想ディスクがありません。' }
    if (@(Get-VMSnapshot -VM $vm -ErrorAction Stop).Count -gt 0) { throw 'チェックポイントがある VM のディスク削除には対応していません。' }
    foreach ($disk in $drives) {
        if (!$disk.Path -or $disk.SupportPersistentReservations) { throw '物理ディスクまたは共有ディスクを含むため、ディスクの削除はできません。' }
    }
    foreach ($path in $paths) { Assert-DeleteDiskFile $path }
    Assert-NoOtherDiskReferences $paths $vm.Id
}

function Get-DeleteInfo([object] $vm) {
    $drives = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
    $paths = @(Get-DeleteDiskPaths $drives)
    $canDelete = $false
    $hasCheckpoints = $false
    $reason = $null
    try {
        $hasCheckpoints = @(Get-VMSnapshot -VM $vm -ErrorAction Stop).Count -gt 0
        if ($vm.State.ToString() -ne 'Off') { throw 'ディスクを削除するには VM のシャットダウンが必要です。' }
        Assert-DeleteDisks $vm $drives $paths
        $canDelete = $true
    }
    catch { $reason = $_.Exception.Message }
    [pscustomobject][ordered]@{ id = $vm.Id.ToString(); name = [string] $vm.Name; state = $vm.State.ToString(); disk_paths = $paths; can_delete_disks = $canDelete; disk_delete_reason = $reason; has_checkpoints = $hasCheckpoints }
}

function Invoke-DeleteVm([object] $request) {
    $vmId = [guid]::Parse([string] $request.id)
    $expectedName = [string] $request.expected_name
    $confirmation = [string] $request.confirmation_name
    if (!$expectedName -or $expectedName.Length -gt 256 -or $expectedName -match '[\x00-\x1f\x7f-\x9f]') { throw '削除対象の VM 名が正しくありません。一覧を更新してください。' }
    if (![string]::Equals($confirmation, $expectedName, [StringComparison]::Ordinal)) { throw '確認用の VM 名が一致しません。大文字・小文字や空白も含めて同じ名前を入力してください。' }
    $vm = Get-VM -Id $vmId -ErrorAction Stop
    if (![string]::Equals([string] $vm.Name, $expectedName, [StringComparison]::Ordinal)) { throw '対象 VM の名前が確認時から変わりました。一覧を更新してやり直してください。' }
    if ($vm.State.ToString() -ne 'Off') { throw 'VM をシャットダウンして停止状態にしてから削除してください。' }
    $drives = @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop)
    $paths = @(Get-DeleteDiskPaths $drives)
    $expectedPaths = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in @($request.expected_disk_paths)) { if (!$expectedPaths.Add((Normalize-IsoPath ([string] $path)))) { throw '確認用のディスク一覧が正しくありません。' } }
    if ($expectedPaths.Count -ne $paths.Count -or @($paths | Where-Object { !$expectedPaths.Contains($_) }).Count -gt 0) { throw '対象 VM のディスク構成が確認時から変わりました。一覧を更新してください。' }
    if ($request.delete_disks) { Assert-DeleteDisks $vm $drives $paths }
    $diskIdentities = @{}
    if ($request.delete_disks) { foreach ($path in $paths) { $diskIdentities[$path] = Get-DeleteDiskIdentity $path } }
    # The full reference scan can take time; refresh the target just before removal.
    $vm = Get-VM -Id $vmId -ErrorAction Stop
    if ($vm.State.ToString() -ne 'Off' -or ![string]::Equals([string] $vm.Name, $expectedName, [StringComparison]::Ordinal)) { throw '確認中に VM の名前または状態が変わりました。一覧を更新してください。' }
    $currentPaths = @(Get-DeleteDiskPaths @(Get-VMHardDiskDrive -VM $vm -ErrorAction Stop))
    if ($currentPaths.Count -ne $paths.Count -or @($currentPaths | Where-Object { !$expectedPaths.Contains($_) }).Count -gt 0) { throw '確認中に VM のディスク構成が変わりました。一覧を更新してください。' }
    if ($request.delete_disks -and @(Get-VMSnapshot -VM $vm -ErrorAction Stop).Count -gt 0) { throw '確認中にチェックポイントが作成されました。ディスク削除を中止しました。' }
    $removeFailure = $null
    try { Remove-VM -VM $vm -Force -ErrorAction Stop }
    catch { $removeFailure = $_.Exception.Message }
    try { $remaining = @(Get-VM -ErrorAction Stop | Where-Object { $_.Id -eq $vmId }) }
    catch { throw '削除要求後の VM の状態を確認できません。ディスク削除は実行していません。一覧を更新して現在の状態を確認してください。' }
    if ($remaining.Count -gt 0) {
        if ($removeFailure) { throw $removeFailure }
        throw 'VM の削除完了を確認できません。一覧を更新してください。'
    }
    $deleted = New-Object 'System.Collections.Generic.List[string]'
    $retained = New-Object 'System.Collections.Generic.List[string]'
    $warnings = New-Object 'System.Collections.Generic.List[string]'
    if ($removeFailure) { $warnings.Add('VM 登録は削除されましたが処理中にエラーが報告されたため、ディスクは削除していません: ' + $removeFailure) }
    foreach ($path in $paths) {
        if (!$request.delete_disks -or $removeFailure) { $retained.Add($path); continue }
        try {
            Assert-DeleteDiskFile $path
            Assert-NoOtherDiskReferences @($path) ([guid]::Empty)
            Assert-DeleteDiskPath $path
            if ((Get-DeleteDiskIdentity $path) -ne $diskIdentities[$path]) { throw '確認中にディスクファイルが置き換わったため削除を中止しました。' }
            # Bind exclusive open and deletion to the same file handle. Any
            # sharing/permission failure preserves the file and becomes a warning.
            $stream = New-Object IO.FileStream($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None, 4096, [IO.FileOptions]::DeleteOnClose)
            $stream.Dispose()
            if (Test-Path -LiteralPath $path) { throw 'ファイルの削除完了を確認できません。' }
            $deleted.Add($path)
        }
        catch { $retained.Add($path); $warnings.Add("ディスクを保持しました: $path 。 $($_.Exception.Message)") }
    }
    [pscustomobject][ordered]@{ id = $vmId.ToString(); deleted_disk_paths = @($deleted.ToArray()); retained_disk_paths = @($retained.ToArray()); warning = if ($warnings.Count -gt 0) { $warnings -join ' ' } else { $null } }
}

function Convert-NetworkGuid([object] $value) {
    $id = [guid]::Empty
    if ([guid]::TryParse([string] $value, [ref] $id) -and $id -ne [guid]::Empty) { return $id.ToString().ToLowerInvariant() }
    return ''
}

function Assert-NetworkGuid([object] $value) {
    $text = [string] $value
    if ($text -cnotmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or !(Convert-NetworkGuid $text)) { throw 'ネットワークの識別子が正しくありません。再読み込みしてください。' }
    Convert-NetworkGuid $text
}

function Assert-NetworkName([object] $value) {
    if ($value -isnot [string] -or !$value -or $value.Length -gt 256 -or $value -cne $value.Trim() -or $value -match '[\x00-\x1f\x7f]') { throw 'スイッチ名には前後の空白と制御文字を含まない1〜256文字を指定してください。' }
    [string] $value
}

function Get-NetworkSwitchContext {
    $switches = @(Get-VMSwitch -ErrorAction Stop | Sort-Object Id)
    $errors = New-Object 'System.Collections.Generic.List[string]'
    $vmAdapters = New-Object 'System.Collections.Generic.List[object]'
    $vms = @(); $hostAdapters = @(); $netAdapters = @(); $addresses = @(); $persistentAddresses = @(); $interfaces = @(); $persistentInterfaces = @(); $routes = @(); $persistentRoutes = @(); $hns = @(); $physical = @()
    try { $vms = @(Get-VM -ErrorAction Stop) } catch { $errors.Add("VMの一覧を取得できません: $($_.Exception.Message)") }
    foreach ($vm in $vms) {
        try { foreach ($adapter in @(Get-VMNetworkAdapter -VM $vm -ErrorAction Stop)) { $vmAdapters.Add([pscustomobject]@{ vm = $vm; adapter = $adapter }) } }
        catch { $errors.Add("VM「$($vm.Name)」のネットワークを取得できません: $($_.Exception.Message)") }
    }
    try { $hostAdapters = @(Get-VMNetworkAdapter -ManagementOS -ErrorAction Stop) } catch { $errors.Add("ホスト側の仮想NICを取得できません: $($_.Exception.Message)") }
    try { $netAdapters = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop) } catch { $errors.Add("ホスト側のNIC情報を取得できません: $($_.Exception.Message)") }
    try { $addresses = @(Get-NetIPAddress -PolicyStore ActiveStore -ErrorAction Stop) } catch { $errors.Add("ホスト側のIPアドレスを取得できません: $($_.Exception.Message)") }
    # Filtering NetTCPIP queries server-side can throw ObjectNotFound for a
    # perfectly valid empty result (notably PersistentStore routes). Enumerate
    # the store and filter locally, keeping genuine access/provider errors fatal.
    try { $persistentAddresses = @(Get-NetIPAddress -PolicyStore PersistentStore -ErrorAction Stop | Where-Object { [string] $_.AddressFamily -eq 'IPv4' }) } catch { $errors.Add("保存済みIPv4アドレスを取得できません: $($_.Exception.Message)") }
    try { $interfaces = @(Get-NetIPInterface -PolicyStore ActiveStore -ErrorAction Stop | Where-Object { [string] $_.AddressFamily -eq 'IPv4' }) } catch { $errors.Add("IPv4のDHCP設定を取得できません: $($_.Exception.Message)") }
    try { $persistentInterfaces = @(Get-NetIPInterface -PolicyStore PersistentStore -ErrorAction Stop | Where-Object { [string] $_.AddressFamily -eq 'IPv4' }) } catch { $errors.Add("保存済みDHCP設定を取得できません: $($_.Exception.Message)") }
    try { $routes = @(Get-NetRoute -PolicyStore ActiveStore -ErrorAction Stop | Where-Object { [string] $_.AddressFamily -eq 'IPv4' }) } catch { $errors.Add("IPv4ルートを取得できません: $($_.Exception.Message)") }
    try { $persistentRoutes = @(Get-NetRoute -PolicyStore PersistentStore -ErrorAction Stop | Where-Object { [string] $_.AddressFamily -eq 'IPv4' }) } catch { $errors.Add("保存済みIPv4ルートを取得できません: $($_.Exception.Message)") }
    try {
        if (Get-Command Get-HnsNetwork -ErrorAction SilentlyContinue) { $hns = @(Get-HnsNetwork -ErrorAction Stop) }
        elseif (@(Get-Service -ErrorAction Stop | Where-Object { $_.Name -eq 'hns' }).Count -gt 0) { throw 'HNSサービスが存在しますが、その管理ネットワークを取得できません。' }
    }
    catch { $errors.Add("Windows管理ネットワークを確認できません: $($_.Exception.Message)") }
    $physicalError = $null
    try { $physical = @(Get-NetAdapter -Physical -IncludeHidden -ErrorAction Stop) } catch { $physicalError = "物理NICを取得できません: $($_.Exception.Message)" }
    [pscustomobject]@{ switches = $switches; vm_adapters = @($vmAdapters.ToArray()); host_adapters = $hostAdapters; net_adapters = $netAdapters; addresses = $addresses; persistent_addresses = $persistentAddresses; interfaces = $interfaces; persistent_interfaces = $persistentInterfaces; routes = $routes; persistent_routes = $persistentRoutes; hns = $hns; physical_adapters = $physical; physical_error = $physicalError; errors = @($errors.ToArray()) }
}

function Test-SystemNetworkSwitch([object] $switch, [object[]] $hnsNetworks) {
    $id = Convert-NetworkGuid $switch.Id
    if ($id -eq 'c08cb7b8-9b3c-408e-8e30-5e16a3aeb444' -or [string] $switch.Name -ieq 'Default Switch' -or [string] $switch.SwitchType -eq 'Ics') { return $true }
    foreach ($property in @('IsSystemManaged', 'IsAutomatic', 'IsDefault')) {
        if ($switch.PSObject.Properties[$property] -and $switch.$property -eq $true) { return $true }
    }
    foreach ($network in $hnsNetworks) {
        if ((Convert-NetworkGuid $network.Id) -eq $id -or (Convert-NetworkGuid $network.SwitchGuid) -eq $id -or [string]::Equals([string] $network.Name, [string] $switch.Name, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    $false
}

function Find-NetworkHostAdapter([object] $adapter, [object[]] $netAdapters, [bool] $allowMacFallback = $true) {
    $deviceId = Convert-NetworkGuid $adapter.DeviceId
    $matches = @()
    if ($deviceId) { $matches = @($netAdapters | Where-Object { (Convert-NetworkGuid $_.InterfaceGuid) -eq $deviceId }) }
    if ($matches.Count -eq 0 -and $allowMacFallback) {
        $mac = ([string] $adapter.MacAddress) -replace '[^0-9a-fA-F]', ''
        if ($mac.Length -eq 12) { $matches = @($netAdapters | Where-Object { (([string] $_.MacAddress) -replace '[^0-9a-fA-F]', '') -ieq $mac }) }
    }
    if ($matches.Count -eq 1) { return $matches[0] }
    $null
}

function Get-NetworkRevision([object] $value) {
    $bytes = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $value -Depth 12 -Compress))
    $sha = [Security.Cryptography.SHA256]::Create()
    try { ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}

function Get-NetworkAddressFootprint([object[]] $addresses) {
    @($addresses | ForEach-Object { [pscustomobject][ordered]@{ index = [int] $_.InterfaceIndex; address = [string] $_.IPAddress; prefix = [int] $_.PrefixLength; origin = [string] $_.PrefixOrigin; suffix_origin = [string] $_.SuffixOrigin; skip_as_source = [bool] $_.SkipAsSource } } | Sort-Object index, address, prefix)
}

function Get-NetworkRouteFootprint([object[]] $routes) {
    @($routes | ForEach-Object { [pscustomobject][ordered]@{ index = [int] $_.InterfaceIndex; destination = [string] $_.DestinationPrefix; next_hop = [string] $_.NextHop; metric = [int] $_.RouteMetric; protocol = [string] $_.Protocol } } | Sort-Object index, destination, next_hop, metric)
}

function Get-NetworkSwitchSnapshot([string] $switchId, [object] $context = $null) {
    $switchId = Assert-NetworkGuid $switchId
    if ($null -eq $context) { $context = Get-NetworkSwitchContext }
    $matches = @($context.switches | Where-Object { (Convert-NetworkGuid $_.Id) -eq $switchId })
    if ($matches.Count -ne 1) { throw '対象の仮想スイッチが見つかりません。再読み込みしてください。' }
    $switch = $matches[0]
    $managed = Test-SystemNetworkSwitch $switch @($context.hns)
    $vmAdapters = @($context.vm_adapters | Where-Object { (Convert-NetworkGuid $_.adapter.SwitchId) -eq $switchId })
    $hostAdapters = @($context.host_adapters | Where-Object { (Convert-NetworkGuid $_.SwitchId) -eq $switchId })
    $hostViews = @($hostAdapters | ForEach-Object {
        $adapter = $_; $net = Find-NetworkHostAdapter $adapter @($context.net_adapters)
        $index = if ($null -ne $net) { [int] $net.ifIndex } else { 0 }
        $settings = @($context.interfaces | Where-Object { $_.InterfaceIndex -eq $index })
        [pscustomobject]@{ name = if ($null -ne $net) { [string] $net.Name } else { [string] $adapter.Name }; interface_guid = if ($null -ne $net) { Convert-NetworkGuid $net.InterfaceGuid } else { '' }; interface_index = $index; mac_address = [string] $adapter.MacAddress; ip_addresses = @($context.addresses | Where-Object { $_.InterfaceIndex -eq $index } | ForEach-Object { '{0}/{1}' -f $_.IPAddress, $_.PrefixLength } | Sort-Object -Unique); dhcp = if ($settings.Count -eq 1) { [string] $settings[0].Dhcp } else { 'Unknown' }; status = if ($null -ne $net) { [string] $net.Status } else { 'Unknown' } }
    })
    $reason = $null; $hostReason = $null; $hostIpv4 = $null; $targetNet = $null
    if ($managed) { $reason = 'WindowsまたはHNSが管理するスイッチは変更できません。' }
    elseif ($context.errors.Count -gt 0) { $reason = '安全確認に必要な情報を取得できません。' + ($context.errors -join ' ') }
    elseif ($vmAdapters.Count -gt 0) { $reason = 'VMのNICが接続されています。先に各VMの接続先を変更または解除してください。' }
    if ($managed) { $hostReason = 'WindowsまたはHNSが管理するスイッチのIPは変更できません。' }
    elseif ($context.errors.Count -gt 0) { $hostReason = '安全確認に必要な情報を取得できません。' + ($context.errors -join ' ') }
    elseif ([string] $switch.SwitchType -cne 'Internal') { $hostReason = 'ホスト側IPv4の設定は内部（Internal）スイッチだけで使用できます。' }
    elseif ($hostAdapters.Count -ne 1) { $hostReason = 'ホスト側の仮想NICを一意に確認できません。' }
    else {
        # For mutations a DeviceId/InterfaceGuid match is mandatory. MAC/name
        # fallbacks are useful for display, but cannot identify a write target.
        $targetNet = Find-NetworkHostAdapter $hostAdapters[0] @($context.net_adapters) $false
        if ($null -eq $targetNet -or !(Convert-NetworkGuid $targetNet.InterfaceGuid) -or [int] $targetNet.ifIndex -le 0) { $hostReason = 'ホスト側NICのGUIDを一意に対応付けられません。' }
        else {
            $index = [int] $targetNet.ifIndex
            $settings = @($context.interfaces | Where-Object { $_.InterfaceIndex -eq $index })
            $persistentSettings = @($context.persistent_interfaces | Where-Object { $_.InterfaceIndex -eq $index })
            $defaultRoutes = @(@($context.routes) + @($context.persistent_routes) | Where-Object { $_.InterfaceIndex -eq $index -and $_.DestinationPrefix -eq '0.0.0.0/0' })
            $hostIpv4 = [pscustomobject]@{ interface_guid = Convert-NetworkGuid $targetNet.InterfaceGuid; interface_index = $index; interface_name = [string] $targetNet.Name; dhcp = if ($settings.Count -eq 1) { [string] $settings[0].Dhcp } else { 'Unknown' }; addresses = @($context.addresses | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.AddressFamily -eq 'IPv4' } | ForEach-Object { [pscustomobject]@{ ip_address = [string] $_.IPAddress; prefix_length = [int] $_.PrefixLength } } | Sort-Object ip_address, prefix_length); has_default_gateway = $defaultRoutes.Count -gt 0 }
            if ($settings.Count -ne 1 -or $persistentSettings.Count -ne 1 -or [string] $settings[0].Dhcp -notin @('Enabled','Disabled') -or [string] $persistentSettings[0].Dhcp -notin @('Enabled','Disabled')) { $hostReason = '現在と保存済みのDHCP設定を確認できません。' }
            elseif ($defaultRoutes.Count -gt 0) { $hostReason = 'このNICにデフォルトゲートウェイがあります。ホストの通信経路を保護するため、ここでは変更できません。' }
            else {
                $activeIpv4 = @($context.addresses | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.AddressFamily -eq 'IPv4' })
                $savedIpv4 = @($context.persistent_addresses | Where-Object { $_.InterfaceIndex -eq $index })
                foreach ($address in @($activeIpv4) + @($savedIpv4)) {
                    if ([string] $address.Type -ne 'Unicast') { $hostReason = '特殊なIPv4アドレス種別があるため、ここでは変更できません。'; break }
                    if ([string] $address.PrefixOrigin -eq 'Manual' -and ($address.ValidLifetime -ne [TimeSpan]::MaxValue -or $address.PreferredLifetime -ne [TimeSpan]::MaxValue)) { $hostReason = '有効期間付きの手動IPv4設定は、ここでは変更できません。'; break }
                }
                if (@($savedIpv4 | Where-Object { [string] $_.PrefixOrigin -ne 'Manual' }).Count -gt 0 -or ([string] $settings[0].Dhcp -eq 'Disabled' -and @($activeIpv4 | Where-Object { [string] $_.PrefixOrigin -ne 'Manual' }).Count -gt 0)) { $hostReason = '元に戻せることを確認できない自動IPv4設定があるため、ここでは変更できません。' }
                foreach ($address in $activeIpv4) {
                    $savedSame = @($savedIpv4 | Where-Object { $_.IPAddress -eq $address.IPAddress })
                    if ($savedSame.Count -gt 1 -or ($savedSame.Count -eq 1 -and ($savedSame[0].PrefixLength -ne $address.PrefixLength -or [bool] $savedSame[0].SkipAsSource -ne [bool] $address.SkipAsSource))) { $hostReason = '現在と保存済みで異なるIPv4の詳細設定があるため、ここでは変更できません。'; break }
                }
            }
        }
    }
    $footprint = [pscustomobject][ordered]@{
        switch = [pscustomobject][ordered]@{ id = $switchId; name = [string] $switch.Name; type = [string] $switch.SwitchType; managed = $managed; sharing = [bool] $switch.AllowManagementOS; physical_guid = [string] $switch.NetAdapterInterfaceGuid; physical_descriptions = @($switch.NetAdapterInterfaceDescriptions); physical_description = [string] $switch.NetAdapterInterfaceDescription }
        errors = @($context.errors | Sort-Object)
        vms = @($vmAdapters | ForEach-Object { [pscustomobject][ordered]@{ vm_id = Convert-NetworkGuid $_.vm.Id; vm_name = [string] $_.vm.Name; adapter_id = [string] $_.adapter.Id; adapter_name = [string] $_.adapter.Name; switch_id = [string] $_.adapter.SwitchId; mac = [string] $_.adapter.MacAddress } } | Sort-Object vm_id, adapter_id)
        hosts = @($hostAdapters | ForEach-Object { [pscustomobject][ordered]@{ id = [string] $_.Id; device_id = [string] $_.DeviceId; name = [string] $_.Name; mac = [string] $_.MacAddress } } | Sort-Object id, device_id)
        net_adapters = @($context.net_adapters | ForEach-Object { [pscustomobject][ordered]@{ guid = Convert-NetworkGuid $_.InterfaceGuid; index = [int] $_.ifIndex; name = [string] $_.Name; mac = [string] $_.MacAddress } } | Sort-Object guid, index)
        active_addresses = @(Get-NetworkAddressFootprint @($context.addresses | Where-Object { [string] $_.AddressFamily -eq 'IPv4' }))
        persistent_addresses = @(Get-NetworkAddressFootprint @($context.persistent_addresses))
        interfaces = @($context.interfaces | ForEach-Object { [pscustomobject][ordered]@{ index = [int] $_.InterfaceIndex; dhcp = [string] $_.Dhcp } } | Sort-Object index)
        persistent_interfaces = @($context.persistent_interfaces | ForEach-Object { [pscustomobject][ordered]@{ index = [int] $_.InterfaceIndex; dhcp = [string] $_.Dhcp } } | Sort-Object index)
        routes = @(Get-NetworkRouteFootprint @($context.routes)); persistent_routes = @(Get-NetworkRouteFootprint @($context.persistent_routes))
    }
    $view = [pscustomobject]@{ switch_id = $switchId; name = [string] $switch.Name; switch_type = [string] $switch.SwitchType; revision = Get-NetworkRevision $footprint; is_system_managed = $managed; can_delete = $null -eq $reason; delete_reason = $reason; can_configure_host_ipv4 = $null -eq $hostReason; host_ipv4_reason = $hostReason; vm_adapter_count = $vmAdapters.Count; host_adapters = $hostViews; host_ipv4 = $hostIpv4 }
    [pscustomobject]@{ view = $view; switch = $switch; context = $context; target_net = $targetNet }
}

function Get-PhysicalNetworkAdapterViews([object] $context) {
    @($context.physical_adapters | ForEach-Object {
        $adapter = $_; $id = Convert-NetworkGuid $adapter.InterfaceGuid; $reason = $context.physical_error
        if ($context.errors.Count -gt 0) { $reason = '安全確認に必要な情報を取得できません。' + ($context.errors -join ' ') }
        if (!$id) { $reason = '物理NICのGUIDを確認できません。' }
        elseif (@($context.net_adapters | Where-Object { (Convert-NetworkGuid $_.InterfaceGuid) -eq $id }).Count -ne 1) { $reason = '物理NICを一意に対応付けられません。' }
        elseif (@($context.switches | Where-Object { (Convert-NetworkGuid $_.NetAdapterInterfaceGuid) -eq $id -or @($_.NetAdapterInterfaceDescriptions) -contains [string] $adapter.InterfaceDescription -or [string]::Equals([string] $_.NetAdapterInterfaceDescription, [string] $adapter.InterfaceDescription, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { $reason = '既存の仮想スイッチに割り当て済みです。' }
        [pscustomobject]@{ interface_guid = $id; name = [string] $adapter.Name; interface_description = [string] $adapter.InterfaceDescription; mac_address = [string] $adapter.MacAddress; status = [string] $adapter.Status; available = $null -eq $reason; unavailable_reason = $reason }
    } | Sort-Object name)
}

function Assert-NetworkChangeRequest([object] $request) {
    $id = Assert-NetworkGuid $request.switch_id
    if ($request.expected_revision -isnot [string] -or [string] $request.expected_revision -cnotmatch '^[0-9a-f]{64}$') { throw '取得時のネットワーク設定を確認できません。再読み込みしてください。' }
    $name = Assert-NetworkName $request.confirmation_name
    $snapshot = Get-NetworkSwitchSnapshot $id
    if ($snapshot.view.revision -cne $request.expected_revision) { throw 'ネットワーク構成が取得後に変わりました。再読み込みしてやり直してください。' }
    if ($snapshot.view.name -cne $name) { throw '確認用のスイッチ名が一致しません。' }
    $snapshot
}

function Invoke-CreateNetworkSwitch([object] $request) {
    $name = Assert-NetworkName $request.name
    if ($request.switch_type -isnot [string] -or [string] $request.switch_type -cnotin @('External','Internal','Private')) { throw '仮想スイッチの種類が正しくありません。' }
    if ($request.allow_management_os -isnot [bool] -or $request.external_impact_confirmed -isnot [bool]) { throw 'ホスト共有と通信影響の確認が正しくありません。' }
    if ($name -ieq 'Default Switch') { throw 'Windows管理スイッチの予約名は使用できません。' }
    $context = Get-NetworkSwitchContext
    if (@($context.switches | Where-Object { [string]::Equals([string] $_.Name, $name, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) { throw '同名の仮想スイッチがすでに存在します。' }
    if ($request.switch_type -ceq 'External') {
        if (!$request.external_impact_confirmed) { throw '外部スイッチの作成によるホスト通信への影響を確認してください。' }
        if ($context.errors.Count -gt 0 -or $context.physical_error) { throw '物理NICの安全確認を完了できません。' + ($context.errors -join ' ') + $context.physical_error }
        $physicalId = Assert-NetworkGuid $request.physical_adapter_guid
        $views = @(Get-PhysicalNetworkAdapterViews $context | Where-Object { $_.interface_guid -eq $physicalId })
        if ($views.Count -ne 1 -or !$views[0].available) { throw '選択した物理NICは使用できません。再読み込みしてください。' }
        $adapters = @($context.physical_adapters | Where-Object { (Convert-NetworkGuid $_.InterfaceGuid) -eq $physicalId })
        if ($adapters.Count -ne 1) { throw '物理NICを一意に確認できません。' }
        # Resolve the stable GUID freshly, then use its exact description rather
        # than treating an adapter name supplied by the UI as a target.
        $description = [string] $adapters[0].InterfaceDescription
        if (!$description -or @($context.net_adapters | Where-Object { [string]::Equals([string] $_.InterfaceDescription, $description, [StringComparison]::OrdinalIgnoreCase) }).Count -ne 1) { throw '物理NICの識別情報が重複しています。' }
        $created = New-VMSwitch -Name $name -NetAdapterInterfaceDescription $description -AllowManagementOS ([bool] $request.allow_management_os) -ErrorAction Stop
    }
    else {
        if ($null -ne $request.physical_adapter_guid -and [string] $request.physical_adapter_guid -ne '') { throw '内部・プライベートスイッチに物理NICは指定できません。' }
        $created = New-VMSwitch -Name $name -SwitchType ([string] $request.switch_type) -ErrorAction Stop
    }
    # Successful creation must not be reported as failed merely because the new
    # host NIC is still appearing. Snapshot errors become denied capabilities.
    $createdId = Assert-NetworkGuid ([string] $created.Id)
    try { (Get-NetworkSwitchSnapshot $createdId).view }
    catch {
        $reason = "スイッチは作成されましたが、作成後の詳細を取得できません。ネットワーク画面を再読み込みしてください。 $($_.Exception.Message)"
        [pscustomobject]@{ switch_id = $createdId; name = $name; switch_type = [string] $request.switch_type; revision = Get-NetworkRevision ([pscustomobject]@{ id = $createdId; created = $true }); is_system_managed = $false; can_delete = $false; delete_reason = $reason; can_configure_host_ipv4 = $false; host_ipv4_reason = $reason; vm_adapter_count = 0; host_adapters = @(); host_ipv4 = $null }
    }
}

function Invoke-DeleteNetworkSwitch([object] $request) {
    $snapshot = Assert-NetworkChangeRequest $request
    if (!$snapshot.view.can_delete) { throw $snapshot.view.delete_reason }
    Remove-VMSwitch -VMSwitch $snapshot.switch -Force -Confirm:$false -ErrorAction Stop
    [pscustomobject]@{ switch_id = $snapshot.view.switch_id; name = $snapshot.view.name }
}

function Convert-StrictHostIpv4([object] $address, [object] $prefix) {
    if ($address -isnot [string] -or [string] $address -cnotmatch '^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$' -or $prefix -isnot [ValueType] -or $prefix -is [bool] -or [double] $prefix -ne [Math]::Truncate([double] $prefix) -or [int] $prefix -lt 1 -or [int] $prefix -gt 30) { throw 'IPv4アドレスと1〜30のプレフィックス長を指定してください。' }
    $ip = $null
    if (![Net.IPAddress]::TryParse([string] $address, [ref] $ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'IPv4アドレスが正しくありません。' }
    $octets = $ip.GetAddressBytes()
    if ($octets[0] -eq 0 -or $octets[0] -eq 127 -or $octets[0] -ge 224) { throw 'ホストに割り当て可能なユニキャストIPv4アドレスを指定してください。' }
    $number = [uint64] $octets[0] * 16777216 + [uint64] $octets[1] * 65536 + [uint64] $octets[2] * 256 + [uint64] $octets[3]
    $size = [uint64] [Math]::Pow(2, 32 - [int] $prefix)
    $network = $number - ($number % $size); $broadcast = $network + $size - 1
    if ($number -eq $network -or $number -eq $broadcast) { throw 'ネットワークアドレスまたはブロードキャストアドレスはホストに割り当てられません。' }
    [pscustomobject]@{ address = $ip.ToString(); prefix = [int] $prefix; start = $network; end = $broadcast }
}

function Assert-NoHostIpv4Overlap([object] $target, [object] $snapshot) {
    $index = [int] $snapshot.target_net.ifIndex
    foreach ($address in @($snapshot.context.addresses) + @($snapshot.context.persistent_addresses)) {
        if ($address.InterfaceIndex -eq $index -or [string] $address.AddressFamily -ne 'IPv4') { continue }
        $ip = $null
        if (![Net.IPAddress]::TryParse([string] $address.IPAddress, [ref] $ip) -or $ip.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw '既存のIPv4アドレスを検証できません。' }
        $octets = $ip.GetAddressBytes(); if ($octets[0] -eq 127) { continue }
        $number = [uint64] $octets[0] * 16777216 + [uint64] $octets[1] * 65536 + [uint64] $octets[2] * 256 + [uint64] $octets[3]
        $length = [int] $address.PrefixLength
        if ($length -lt 0 -or $length -gt 32) { throw '既存のIPv4プレフィックスを検証できません。' }
        $size = [uint64] [Math]::Pow(2, 32 - $length); $start = $number - ($number % $size); $end = $start + $size - 1
        if ($target.start -le $end -and $start -le $target.end) { throw "指定したIPv4ネットワークが別のホストNIC（$($address.InterfaceAlias)、$($address.IPAddress)/$length）と重複します。" }
    }
}

function Assert-HostNetworkTarget([object] $snapshot) {
    $guid = Convert-NetworkGuid $snapshot.target_net.InterfaceGuid
    $matches = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { (Convert-NetworkGuid $_.InterfaceGuid) -eq $guid })
    if ($matches.Count -ne 1 -or [int] $matches[0].ifIndex -ne [int] $snapshot.target_net.ifIndex) { throw '操作中にホストNICの識別情報が変わりました。再読み込みしてください。' }
}

function Clear-HostIpv4Addresses([object] $snapshot) {
    foreach ($store in @('PersistentStore', 'ActiveStore')) {
        Assert-HostNetworkTarget $snapshot
        foreach ($address in @(Get-NetIPAddress -PolicyStore $store -ErrorAction Stop | Where-Object { $_.InterfaceIndex -eq [int] $snapshot.target_net.ifIndex -and [string] $_.AddressFamily -eq 'IPv4' })) {
            Remove-NetIPAddress -InterfaceIndex ([int] $snapshot.target_net.ifIndex) -AddressFamily IPv4 -IPAddress ([string] $address.IPAddress) -PrefixLength ([byte] $address.PrefixLength) -PolicyStore $store -Confirm:$false -ErrorAction Stop
        }
    }
}

function Restore-HostIpv4([object] $snapshot) {
    Assert-HostNetworkTarget $snapshot
    $index = [int] $snapshot.target_net.ifIndex
    Clear-HostIpv4Addresses $snapshot
    $active = @($snapshot.context.addresses | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.AddressFamily -eq 'IPv4' -and [string] $_.PrefixOrigin -eq 'Manual' })
    $persistent = @($snapshot.context.persistent_addresses | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.PrefixOrigin -eq 'Manual' })
    foreach ($address in $persistent) {
        New-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -IPAddress ([string] $address.IPAddress) -PrefixLength ([byte] $address.PrefixLength) -SkipAsSource ([bool] $address.SkipAsSource) -ValidLifetime $address.ValidLifetime -PreferredLifetime $address.PreferredLifetime -ErrorAction Stop | Out-Null
    }
    foreach ($address in $active) {
        if (@($persistent | Where-Object { $_.IPAddress -eq $address.IPAddress -and $_.PrefixLength -eq $address.PrefixLength }).Count -eq 0) {
            New-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -IPAddress ([string] $address.IPAddress) -PrefixLength ([byte] $address.PrefixLength) -SkipAsSource ([bool] $address.SkipAsSource) -ValidLifetime $address.ValidLifetime -PreferredLifetime $address.PreferredLifetime -PolicyStore ActiveStore -ErrorAction Stop | Out-Null
        }
    }
    foreach ($address in $persistent) {
        if (@($active | Where-Object { $_.IPAddress -eq $address.IPAddress -and $_.PrefixLength -eq $address.PrefixLength }).Count -eq 0) {
            Remove-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -IPAddress ([string] $address.IPAddress) -PrefixLength ([byte] $address.PrefixLength) -PolicyStore ActiveStore -Confirm:$false -ErrorAction Stop
        }
    }
    foreach ($store in @('PersistentStore', 'ActiveStore')) {
        $settings = if ($store -eq 'ActiveStore') { @($snapshot.context.interfaces | Where-Object { $_.InterfaceIndex -eq $index }) } else { @($snapshot.context.persistent_interfaces | Where-Object { $_.InterfaceIndex -eq $index }) }
        Assert-HostNetworkTarget $snapshot
        Set-NetIPInterface -InterfaceIndex $index -AddressFamily IPv4 -Dhcp ([string] $settings[0].Dhcp) -PolicyStore $store -ErrorAction Stop
        $restoredSettings = @(Get-NetIPInterface -PolicyStore $store -ErrorAction Stop | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.AddressFamily -eq 'IPv4' })
        $restoredAddresses = @(Get-NetIPAddress -PolicyStore $store -ErrorAction Stop | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.AddressFamily -eq 'IPv4' -and [string] $_.PrefixOrigin -eq 'Manual' })
        $expectedAddresses = @(if ($store -eq 'ActiveStore') { $active } else { $persistent })
        if ($restoredSettings.Count -ne 1 -or [string] $restoredSettings[0].Dhcp -ne [string] $settings[0].Dhcp -or (Get-NetworkRevision @(Get-NetworkAddressFootprint $restoredAddresses)) -cne (Get-NetworkRevision @(Get-NetworkAddressFootprint $expectedAddresses))) { throw '元のDHCP・手動IPv4設定の復元結果を確認できません。' }
    }
}

function Save-HostNetworkIpv4([object] $request) {
    $target = Convert-StrictHostIpv4 $request.ip_address $request.prefix_length
    $snapshot = Assert-NetworkChangeRequest $request
    if (!$snapshot.view.can_configure_host_ipv4) { throw $snapshot.view.host_ipv4_reason }
    Assert-NoHostIpv4Overlap $target $snapshot
    Assert-HostNetworkTarget $snapshot
    $index = [int] $snapshot.target_net.ifIndex
    try {
        foreach ($store in @('PersistentStore', 'ActiveStore')) { Set-NetIPInterface -InterfaceIndex $index -AddressFamily IPv4 -Dhcp Disabled -PolicyStore $store -ErrorAction Stop }
        Clear-HostIpv4Addresses $snapshot
        Assert-HostNetworkTarget $snapshot
        # Omitting PolicyStore persists the address and creates its active copy.
        New-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -IPAddress $target.address -PrefixLength ([byte] $target.prefix) -ErrorAction Stop | Out-Null
        $result = Get-NetworkSwitchSnapshot $snapshot.view.switch_id
        if (!$result.view.can_configure_host_ipv4 -or $result.view.host_ipv4.dhcp -ne 'Disabled') { throw '設定後のホスト側IPv4を確認できません。' }
        $active = @($result.context.addresses | Where-Object { $_.InterfaceIndex -eq $index -and [string] $_.AddressFamily -eq 'IPv4' })
        $saved = @($result.context.persistent_addresses | Where-Object { $_.InterfaceIndex -eq $index })
        if ($active.Count -ne 1 -or $saved.Count -ne 1 -or $active[0].IPAddress -ne $target.address -or $active[0].PrefixLength -ne $target.prefix -or $saved[0].IPAddress -ne $target.address -or $saved[0].PrefixLength -ne $target.prefix -or [string] $active[0].AddressState -in @('Duplicate','Invalid')) { throw '指定したIPv4の保存結果を確認できません。' }
        for ($attempt = 0; [string] $active[0].AddressState -eq 'Tentative' -and $attempt -lt 10; $attempt++) {
            Start-Sleep -Milliseconds 500
            Assert-HostNetworkTarget $snapshot
            $active = @(Get-NetIPAddress -InterfaceIndex $index -AddressFamily IPv4 -PolicyStore ActiveStore -ErrorAction Stop | Where-Object { $_.IPAddress -eq $target.address -and $_.PrefixLength -eq $target.prefix })
            if ($active.Count -ne 1) { throw 'IPv4アドレスの重複確認中に設定が変わりました。' }
        }
        if ([string] $active[0].AddressState -notin @('Preferred','Deprecated')) { throw 'IPv4アドレスの重複確認が完了しないか、アドレスを使用できません。' }
        $result.view
    }
    catch {
        $failure = $_.Exception.Message
        try { Restore-HostIpv4 $snapshot }
        catch { throw "IPv4の変更に失敗し、元の設定の復元も完了できませんでした。ホストのネットワーク設定を確認してください。変更: $failure 復元: $($_.Exception.Message)" }
        throw "IPv4の変更に失敗したため、元の手動IPv4設定とDHCP設定を復元しました。DHCPによるIPは再取得され、以前と変わる場合があります。 $failure"
    }
}

function Get-NetworkInventory {
    $context = Get-NetworkSwitchContext
    $warnings = New-Object 'System.Collections.Generic.List[string]'
    foreach ($message in $context.errors) { $warnings.Add($message) }
    if ($context.physical_error) { $warnings.Add($context.physical_error) }
    $views = @($context.switches | Sort-Object Name | ForEach-Object {
        $switch = $_; $id = Convert-NetworkGuid $switch.Id
        $snapshot = Get-NetworkSwitchSnapshot $id $context
        $hosts = @($context.host_adapters | Where-Object { (Convert-NetworkGuid $_.SwitchId) -eq $id } | ForEach-Object {
            $adapter = $_; $net = Find-NetworkHostAdapter $adapter @($context.net_adapters)
            if ($null -ne $net) {
                [pscustomobject]@{ name = [string] $net.Name; interface_description = [string] $net.InterfaceDescription; mac_address = [string] $adapter.MacAddress; ip_addresses = @($context.addresses | Where-Object { $_.InterfaceIndex -eq $net.ifIndex -and $_.IPAddress } | ForEach-Object { '{0}/{1}' -f $_.IPAddress, $_.PrefixLength } | Sort-Object -Unique); status = [string] $net.Status }
            }
            else {
                $warnings.Add("スイッチ「$($switch.Name)」のホスト側NICを一意に対応付けられないため、IPを表示できません。")
                [pscustomobject]@{ name = [string] $adapter.Name; interface_description = ''; mac_address = [string] $adapter.MacAddress; ip_addresses = @(); status = 'Unknown' }
            }
        })
        $vms = @($context.vm_adapters | Where-Object { (Convert-NetworkGuid $_.adapter.SwitchId) -eq $id } | ForEach-Object {
            [pscustomobject]@{ vm_id = Convert-NetworkGuid $_.vm.Id; vm_name = [string] $_.vm.Name; vm_state = [string] $_.vm.State; adapter_name = [string] $_.adapter.Name; mac_address = [string] $_.adapter.MacAddress; ip_addresses = @($_.adapter.IPAddresses | Where-Object { ![string]::IsNullOrWhiteSpace([string] $_) } | ForEach-Object { [string] $_ } | Sort-Object -Unique) }
        } | Sort-Object vm_name, adapter_name)
        [pscustomobject]@{ id = $id; name = [string] $switch.Name; switch_type = [string] $switch.SwitchType; external_adapter_description = if ($switch.NetAdapterInterfaceDescription) { [string] $switch.NetAdapterInterfaceDescription } else { $null }; host_adapters = $hosts; vm_adapters = $vms; is_system_managed = $snapshot.view.is_system_managed; can_delete = $snapshot.view.can_delete; delete_reason = $snapshot.view.delete_reason; can_configure_host_ipv4 = $snapshot.view.can_configure_host_ipv4; host_ipv4_reason = $snapshot.view.host_ipv4_reason }
    })
    [pscustomobject]@{ switches = $views; warnings = @($warnings.ToArray()); physical_adapters = @(Get-PhysicalNetworkAdapterViews $context) }
}
function Convert-Vm([object] $vm) {
    [pscustomobject][ordered]@{
        id = $vm.Id.ToString()
        name = [string] $vm.Name
        state = $vm.State.ToString()
        generation = [int] $vm.Generation
        memory_startup_bytes = [long] $vm.MemoryStartup
        memory_assigned_bytes = [long] $vm.MemoryAssigned
        processor_count = [int] $vm.ProcessorCount
        uptime_seconds = [long] [Math]::Floor($vm.Uptime.TotalSeconds)
    }
}

try {
    Import-Module (Join-Path $PSHOME 'Modules\Hyper-V') -ErrorAction Stop
    $payload = $env:HYPERV_STUDIO_PAYLOAD | ConvertFrom-Json -ErrorAction Stop

    switch ($env:HYPERV_STUDIO_ACTION) {
        'status' {
            try {
                $hostInfo = Get-VMHost -ErrorAction Stop
                $switchNames = @((Get-VMSwitch -ErrorAction Stop | ForEach-Object { [string] $_.Name }))
                Write-Json ([pscustomobject][ordered]@{
                    computer_name = [Environment]::MachineName
                    can_manage = $true
                    error = $null
                    default_vm_path = [string] $hostInfo.VirtualMachinePath
                    default_vhd_path = [string] $hostInfo.VirtualHardDiskPath
                    switches = $switchNames
                })
            }
            catch {
                Write-Json ([pscustomobject][ordered]@{
                    computer_name = [Environment]::MachineName
                    can_manage = $false
                    error = $_.Exception.Message
                    default_vm_path = $null
                    default_vhd_path = $null
                    switches = @()
                })
            }
            break
        }
        'list' {
            $views = @((Get-VM -ErrorAction Stop | ForEach-Object { Convert-Vm $_ }))
            Write-Json $views
            break
        }
        'network_inventory' {
            Write-Json (Get-NetworkInventory)
            break
        }
        'get_network_switch_change_info' {
            Write-Json (Get-NetworkSwitchSnapshot ([string] $payload.switch_id)).view
            break
        }
        'create_network_switch' {
            Write-Json (Invoke-CreateNetworkSwitch $payload)
            break
        }
        'delete_network_switch' {
            Write-Json (Invoke-DeleteNetworkSwitch $payload)
            break
        }
        'save_host_network_ipv4' {
            Write-Json (Save-HostNetworkIpv4 $payload)
            break
        }
        'get' {
            $vm = Get-VM -Id ([guid]::Parse([string] $payload.id)) -ErrorAction Stop
            Write-Json (Convert-Vm $vm)
            break
        }
        'get_boot_settings' {
            $vm = Get-VM -Id ([guid]::Parse([string] $payload.id)) -ErrorAction Stop
            Write-Json (Get-VmBootSnapshot $vm).view
            break
        }
        'save_boot_settings' {
            Write-Json (Save-VmBootSettings $payload)
            break
        }
        'iso_users' {
            $targetPath = Normalize-IsoPath ([string] $payload.path)
            $users = @((Get-VM -ErrorAction Stop | ForEach-Object {
                $ownerVm = $_
                Get-VMDvdDrive -VM $ownerVm -ErrorAction Stop | Where-Object {
                    $_.Path -and [string]::Equals((Normalize-IsoPath $_.Path), $targetPath, [StringComparison]::OrdinalIgnoreCase)
                } | ForEach-Object { [string] $ownerVm.Name }
            } | Sort-Object -Unique))
            Write-Json $users
            break
        }
        'start' {
            $vmId = [guid]::Parse([string] $payload.id)
            $vm = Get-VM -Id $vmId -ErrorAction Stop
            if ($vm.State.ToString() -in @('Off', 'Saved')) {
                Start-VM -VM $vm -ErrorAction Stop | Out-Null
            }
            Write-Json (Convert-Vm (Get-VM -Id $vmId -ErrorAction Stop))
            break
        }
        'stop' {
            $vmId = [guid]::Parse([string] $payload.id)
            $vm = Get-VM -Id $vmId -ErrorAction Stop
            if ($vm.State.ToString() -ne 'Off') {
                Stop-VM -VM $vm -ErrorAction Stop | Out-Null
            }
            Write-Json (Convert-Vm (Get-VM -Id $vmId -ErrorAction Stop))
            break
        }
        'delete' {
            Write-Json (Invoke-DeleteVm $payload)
            break
        }
        'delete_info' {
            $vm = Get-VM -Id ([guid]::Parse([string] $payload.id)) -ErrorAction Stop
            Write-Json (Get-DeleteInfo $vm)
            break
        }
        'rename' {
            $vmId = [guid]::Parse([string] $payload.id)
            $vm = Get-VM -Id $vmId -ErrorAction Stop
            $name = ([string] $payload.name).Trim()
            if (!$name -or $name.Length -gt 64 -or $name -match '[<>:"/\\|?*\x00-\x1f\x7f]' -or $name -match '[. ]$' -or $name -in @('.', '..') -or $name -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])($|\.)') {
                throw 'VM 名には Windows のファイル名に使用できる 1〜64 文字を指定してください。'
            }
            if (@(Get-VM -ErrorAction Stop | Where-Object { $_.Id -ne $vmId -and [string]::Equals($_.Name, $name, [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0) {
                throw "同名の VM '$name' がすでに存在します。"
            }
            if ($vm.Name -cne $name) { Rename-VM -VM $vm -NewName $name -ErrorAction Stop | Out-Null }
            Write-Json (Convert-Vm (Get-VM -Id $vmId -ErrorAction Stop))
            break
        }
        'clone' {
            Invoke-CloneVm $payload
            break
        }
        'list_network_adapters' {
            $vm = Get-VM -Id ([guid]::Parse([string] $payload.id)) -ErrorAction Stop
            Write-Json @(Get-OrderedVmNetworkAdapters $vm | ForEach-Object { Convert-NetworkAdapter $_ })
            break
        }
        'save_network_adapters' {
            $vm = Get-VM -Id ([guid]::Parse([string] $payload.vm_id)) -ErrorAction Stop
            Write-Json @(Save-NetworkAdapters $vm @($payload.adapters) @($payload.expected_adapter_ids))
            break
        }
        'create' {
            Write-Json (Convert-Vm (Invoke-CreateVm $payload))
            break
        }
        default {
            throw '未対応の Hyper-V 操作です。'
        }
    }
    exit 0
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
