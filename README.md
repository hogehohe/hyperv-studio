# Hyper-V Studio

[Esperanto](#esperanto) | [日本語](#日本語)

## Esperanto

Labortabla aplikaĵo por Windows, kiu ebligas krei kaj administri lokajn virtualajn maŝinojn de Hyper-V. Ĝi estas konstruita per Tauri, Rust, React kaj TypeScript.

### Ĉefaj funkcioj

- Listigi, krei, ŝalti kaj normale malŝalti virtualajn maŝinojn; malfermi iliajn konzolojn
- Alinomi, forigi kaj kloni virtualajn maŝinojn kun sendependaj virtualaj diskoj
- Registri haltigitajn VM-ojn kiel protektatajn ŝablonojn kaj krei ordinarajn VM-ojn el ili
- Administri bibliotekon de ISO-bildoj kaj elekti operaciuman bildon dum kreado de nova maŝino
- Agordi plurajn retadaptilojn, Secure Boot kaj la lanĉordon
- Vidi virtualajn ŝaltilojn, hostajn retadaptilojn kaj la IP-adresojn raportitajn de Hyper-V en la retlisto
- Agordi la komputilan nomon kaj DHCP dum klonado de preparitaj AlmaLinux / Rocky Linux / RHEL-maŝinoj
- Elekti helan aŭ malhelan aspekton, aŭ sekvi la sisteman agordon

La Windows-versio petas administrantajn rajtojn per UAC ĉe lanĉo. Hyper-V kaj ĝia PowerShell-modulo estas bezonataj.

### Ŝablonoj kaj retlisto

Por registri ŝablonon, elektu haltigitan VM-on kaj premu 「テンプレートとして登録…」; konfirmu per ĝia ekzakte tajpita nomo. Ĝi aperas en la aparta sekcio 「テンプレート」. Dum ĝi estas registrita, la aplikaĵo blokas ĝiajn ekfunkciigon, malŝalton, konzolan konekton, renomadon, forigon kaj ŝanĝojn de retaj aŭ ekŝargaj agordoj. Vidi la agordojn kaj kloni restas eble; la klono estas ordinara VM. Por redakti la originalon, unue malregistru ĝin, denove konfirmante la ekzaktan nomon. Tio ne forigas la VM-on aŭ ĝiajn diskojn. Registrado ne preparas la gastoperaciumon por cloud-init. La protekto estas loka al ĉi tiu aplikaĵo kaj Windows-uzantokonto; ĝi ne malhelpas ŝanĝojn per Hyper-V Manager, PowerShell aŭ aliaj iloj.

La sekcio 「ネットワーク」 estas nurlega listo de ŝaltiloj External / Internal / Private, iliaj hostaj retadaptiloj kun IP-adreso kaj prefikslongo, kaj la konektitaj VM-NIC-oj. VM-adresoj estas valoroj raportitaj de Hyper-V kaj povas manki aŭ esti malaktualaj. Internal ne nepre signifas reton sen ekstera konekto: NAT aŭ vojigo povas ligi ĝin al aliaj retoj. La listo ne determinas DHCP- aŭ NAT-agordojn kaj ne testas konekteblecon. Detalaj instrukcioj kaj la proceduro por forigi restantan ŝablonregistron de ne plu ekzistanta VM troviĝas en [la README de la aplikaĵo](hyperv-studio/README.md#esperanto).

### Instalado

Malfermu [la plej novan eldonon en GitHub Releases](https://github.com/hogehohe/hyperv-studio/releases/latest), elŝutu `Hyper-V-Studio_<versio>_x64-offline-setup.exe` el Assets kaj rulu ĝin.

La instalilo enhavas la kompletan instalilon de WebView2. Se WebView2 jam estas instalita, ĝi preterlasas ĝian instaladon; se ĝi mankas, ĝi instalas ĝin el la kunpakita dosiero sen Interreta konekto. Node.js, Rust kaj Microsoft C++ Build Tools ne estas bezonataj por uzi la aplikaĵon. Hyper-V kaj ĝia PowerShell-modulo devas esti ebligitaj en Windows.

### Programado kaj konstruado

Ĉi tiu sekcio celas nur tiujn, kiuj volas modifi la fontkodon aŭ mem konstrui la aplikaĵon. Instalu Node.js, la Rust-ilĉenon por MSVC, Microsoft C++ Build Tools kaj WebView2. Rulu la jenajn komandojn en PowerShell malfermita kun administrantaj rajtoj.

```powershell
cd hyperv-studio
npm ci
npm run tauri dev
```

Por krei la instalilon por Windows:

```powershell
npm run tauri build
```

La instalilo estas generata en `hyperv-studio/src-tauri/target/release/bundle/nsis/`.

La norma konstruo kunpakas la kompletan instalilon de WebView2. La unua pakado bezonas Interretan konekton por akiri ĝin; la rezulta instalilo ne bezonas tiun elŝuton dum instalado.

Pri uzado, defaŭltaj valoroj, preparado de Linuksa ŝablono kaj la kondiĉoj por klonado, vidu [la README de la aplikaĵo](hyperv-studio/README.md#esperanto).

## 日本語

ローカルの Hyper-V 仮想マシンを構築・管理する Windows 向けデスクトップアプリです。Tauri / Rust / React / TypeScript で実装しています。

### 主な機能

- VM の一覧、作成、起動、シャットダウン、コンソール接続
- 名前変更、削除、独立した仮想ディスクを持つ VM の複製
- 停止中 VM のテンプレート登録・保護と、テンプレートから通常 VM を作成
- ISO ライブラリと、OS イメージを選ぶ新規作成画面
- 複数 NIC の設定、Secure Boot と起動順序の変更
- 仮想スイッチ、ホスト側 NIC、Hyper-V が報告した IP アドレスをネットワーク一覧で表示
- 準備済み AlmaLinux / Rocky Linux / RHEL の複製時にホスト名・DHCP を設定
- ライト / ダーク / システムに合わせる外観設定

Windows 版は起動時に UAC で管理者権限を要求します。Hyper-V と Hyper-V PowerShell モジュールが必要です。

### テンプレートとネットワーク一覧

停止中の VM で「テンプレートとして登録…」を選び、VM 名を完全一致で入力すると、専用の「テンプレート」一覧へ移ります。登録中は、このアプリからの起動・停止・接続・名前変更・削除・ネットワークや起動設定の変更を防ぎます。構成の閲覧と複製はでき、複製先は通常の VM になります。元 VM を変更する場合は、再度 VM 名を完全一致で入力して登録を解除します。解除しても VM とディスクは削除しません。登録だけではゲスト OS の cloud-init 準備は実行しません。保護はこのアプリと Windows ユーザー単位のもので、Hyper-V マネージャー、PowerShell、ほかのツールからの変更は防げません。

「ネットワーク」は、External / Internal / Private の仮想スイッチ、ホスト側 NIC の IP アドレスとプレフィックス長、接続中の VM の NIC を確認する読み取り専用の一覧です。VM 側 IP は Hyper-V が報告した値で、未取得・古い値の場合があります。Internal でも NAT やルーティングにより外部へ接続できる構成があります。一覧では DHCP・NAT の設定や通信可否を判定しません。詳しい操作と、VM が見つからなくなった場合に残ったテンプレート登録を解除する手順は [アプリの README](hyperv-studio/README.md#日本語) を参照してください。

### インストール

[GitHub Releases の最新版](https://github.com/hogehohe/hyperv-studio/releases/latest)の Assets から、`Hyper-V-Studio_<バージョン>_x64-offline-setup.exe` をダウンロードして実行します。

WebView2 の完全なインストーラーを同梱しています。導入済みならそのインストールをスキップし、未導入なら同梱ファイルからネット接続なしで導入します。アプリを使う人が Node.js・Rust・Microsoft C++ Build Tools を準備する必要はありません。Hyper-V とその PowerShell モジュールは Windows 側で有効化しておいてください。

### 開発・ビルド

この節は、ソースコードを変更する人や自分でビルドする人向けです。Node.js、Rust MSVC、Microsoft C++ Build Tools、WebView2 を用意し、管理者権限で開いた PowerShell から実行します。

```powershell
cd hyperv-studio
npm ci
npm run tauri dev
```

Windows インストーラーの作成:

```powershell
npm run tauri build
```

インストーラーは `hyperv-studio/src-tauri/target/release/bundle/nsis/` に生成します。

標準のビルドで WebView2 の完全なインストーラーを同梱します。初回の作成時は WebView2 の取得用にインターネット接続が必要ですが、生成したインストーラーはインストール時に WebView2 をダウンロードする必要がありません。

操作方法、既定値、Linux テンプレートの準備、複製の条件は [アプリの README](hyperv-studio/README.md#日本語) を参照してください。
