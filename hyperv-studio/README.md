# Hyper-V Studio

[Esperanto](#esperanto) | [日本語](#日本語)

## Esperanto

Tauri-aplikaĵo por Windows, kiu administras la virtualajn maŝinojn de Hyper-V en ĉi tiu komputilo. La interfaco uzas React / TypeScript; por operacioj kun VM-oj, Rust vokas la modulon Hyper-V de Windows PowerShell 5.1.

### Funkcioj de la unua versio

- Listo kaj serĉado de VM-oj en la loka gastiganto, kun montrado de iliaj stato kaj agordoj
- Renomado de VM-oj kaj kontrolo de jam uzataj nomoj
- Forigo de haltigitaj VM-oj, kun eblo ankaŭ forigi iliajn proprajn virtualajn diskojn
- Ekfunkciigo de VM-oj kaj plufunkciigo el konservita stato
- Malfermo de la konzolo de la elektita VM per 「接続」 (konekti)
- Ŝanĝo de la ekŝarga ordo de ekzistantaj VM-oj kaj ŝalto aŭ malŝalto de Secure Boot por VM-oj de la 2-a generacio
- Normala malŝalto de la gastoperaciumo (sen deviga fortranĉo de la elektro)
- Kreado de VM-oj de la 1-a / 2-a generacio kaj novaj VHDX-diskoj; elekto de vCPU-oj, memoro, virtualaj ŝaltiloj por pluraj NIC-oj kaj operaciuma diskbildo
- Erarmesaĝoj se mankas administraj rajtoj por Hyper-V
- Elekto de hela, malhela aŭ laŭsistema aspekto per 「設定 → 外観」 (agordoj → aspekto), konservata ankaŭ por la sekva lanĉo
- Importo de ISO-diskbildoj en la datumdosierujon de la aplikaĵo kaj administrado laŭ operaciuma nomo kaj tipo per 「設定 → OSイメージ」 (agordoj → operaciumaj diskbildoj)
- Klonado de haltigitaj VM-oj sub aliaj nomoj; por antaŭpreparita Linux, ankaŭ agordo de la komputilnomo ene de la operaciumo kaj de DHCP

### Defaŭltaj valoroj por novaj VM-oj

| Agordo | Defaŭlta valoro |
| --- | --- |
| Memoro je ekfunkciigo | 8 GiB (8192 MiB / 8,589,934,592 bajtoj) |
| Kapacito de la virtuala disko | 200 GiB (214,748,364,800 bajtoj) |
| Generacio | 2-a generacio |
| vCPU | 2 |
| Dosierujo de la VM-agordoj | `C:\Virtual Machines\<VM名>` |
| Virtuala disko | `C:\Virtual Machines\<VM名>\<VM名>.vhdx` |
| Ekŝarga aparato | Kun ISO: DVD → VHD; sen ISO: unue VHD |
| Versio de la VM-agorda formato | 12.0 |

En la kreofenestro eblas ŝanĝi la memoron, diskokapaciton, generacion kaj nombron de vCPU-oj. La virtuala disko kreskas dinamike; 200 GiB estas ĝia maksimuma kapacito. Antaŭ kreado la aplikaĵo kontrolas, ĉu la gastiganto subtenas la agordan version 12.0. Se jam ekzistas samnoma dosierujo aŭ disko, ĝi montras eraron kaj nenion anstataŭigas. Ĝi ne ŝanĝas ekzistantajn VM-ojn aŭ la defaŭltajn konservolokojn de la gastiganto Hyper-V.

Se ISO estas elektita, ĝi estas konektita al la DVD-legilo, kaj la ekŝarga ordo estas DVD → virtuala fiksdisko → aliaj ekŝargaj aparatoj. Por malplenaj VM-oj sen ISO kaj por klonitaj VM-oj, la virtuala fiksdisko estas la unua. En ĉi tiu unua versio, la instalado de la operaciumo mem ne estas aŭtomatigita. Post la instalado, malkonektu la ISO aŭ metu la virtualan fiksdiskon unue en la agordoj de Hyper-V.

### Malfermi la konzolon de VM

Elektu VM-on en la listo kaj premu 「接続」 (konekti) en la detaloj. La norma Windows-programo 「仮想マシン接続」 (Virtual Machine Connection, VMConnect) malfermiĝas en aparta fenestro. 「起動」 ekfunkciigas la VM-on; 「接続」 malfermas ĝian konzolon. La konektofenestro estas malfermebla ankaŭ kiam la VM estas haltigita, funkcianta, en konservita stato aŭ paŭzigita.

Por konekti necesas administraj rajtoj por Hyper-V kaj la Windows-programo `vmconnect.exe`. Fermi la konektofenestron ne haltigas la VM-on.

### Ekŝargaj agordoj de ekzistantaj VM-oj

Elektu VM-on kaj malfermu 「起動設定」 (ekŝargaj agordoj) en ĝiaj detaloj. Por VM-oj de la 2-a generacio eblas ŝalti aŭ malŝalti Secure Boot. La nuna atestila ŝablono estas montrata kaj restas senŝanĝa dum ŝalto aŭ malŝalto.

La ekŝargaj eroj estas provataj de supre malsupren. Per 「上へ」 (supren) kaj 「下へ」 (malsupren) eblas reordigi virtualajn diskojn, DVD-legilojn, retajn aparatojn, ekŝargajn erojn de operaciumoj kaj aliajn erojn. La aplikaĵo ne aldonas aŭ forigas ekŝargajn erojn. Por VM-oj de la 1-a generacio eblas ŝanĝi nur la BIOS-ekŝargan ordon; Secure Boot ne estas subtenata.

Agordoj estas konserveblaj nur por haltigita VM. Por funkcianta, konservita aŭ paŭzigita VM eblas nur vidi la agordojn; la aplikaĵo neniam aŭtomate haltigas ĝin. Se alia ilo aŭ la operaciumo ŝanĝas la agordojn aŭ ekŝargajn erojn post malfermo de la fenestro, la konservado estas nuligita. Premu 「再取得」 (relegi) por ŝargi la plej freŝajn agordojn antaŭ ol redakti.

### Renomi VM-on

Elektu VM-on en la listo, premu la krajonan butonon apud ĝia nomo en la detaloj, enigu novan nomon kaj konservu. Tio eblas ankaŭ dum la VM funkcias. Konservado ne eblas se alia VM jam havas la saman nomon. Ĉi tiu operacio ŝanĝas la montratan nomon en Hyper-V; ĝi ne ŝanĝas la komputilnomon ene de la gastoperaciumo aŭ la dosiernomon de la virtuala disko.

### Forigi VM-on

Elektu haltigitan VM-on kaj premu 「VMを削除」 (forigi VM-on) ĉe la malsupro de ĝiaj detaloj. Kontrolu la montratajn celon kaj diskajn dosiervojojn, kaj enigu la VM-nomon en la konfirmokampon, respektante majusklojn kaj minusklojn. Se vi elektas 「仮想ディスクも削除」 (ankaŭ forigi la virtualajn diskojn), la montrataj diskoj ankaŭ estos forigitaj. Defaŭlte la diskoj estas konservataj. Ne eblas malfari la forigon.

Diskoforigo celas sendependajn lokajn dosierojn `.vhd` / `.vhdx`. La opcio estas malŝaltita por agordoj, kies sekurecon la aplikaĵo ne povas konfirmi: komunaj aŭ diferencaj diskoj, diskoj muntitaj en la gastiganto, agordoj kun kontrolpunktoj, dosieroj referencataj de diskoj de aliaj registritaj VM-oj aŭ kontrolpunktoj aŭ de iliaj gepatraj diskoj, dosiervojoj enhavantaj ligilojn, kaj aliaj nekontroleblaj agordoj. Referencoj de neregistritaj VM-oj aŭ de konservataj diferencdiskoj ne estas detekteblaj; konservu diskojn, kiujn vi intencas reuzi.

Se vi forigas nur la registradon de VM, Hyper-V forigas ĝiajn agordodosierojn sed konservas la virtualajn diskojn. Se ekzistas kontrolpunktoj, Hyper-V forigas kaj kunfandas ilin ([dokumentaro de Microsoft pri Remove-VM](https://learn.microsoft.com/en-us/powershell/module/hyper-v/remove-vm)). Se, dum operacio kiu ankaŭ forigas diskojn, iuj dosieroj ne estas forigeblaj, la interfaco montras, ke la VM estis malregistrita, kaj listigas la dosiervojojn de la restantaj dosieroj.

### Administri operaciumajn diskbildojn

1. Per 「設定 → OSイメージ → ISOを選択」 (agordoj → operaciumaj diskbildoj → elekti ISO) elektu lokan ISO-dosieron.
2. Kontrolu la operaciuman nomon kaj tipon (Windows / Linux / alia) kaj premu 「取り込む」 (importi). La kopia progreso estas montrata.
3. En la kampo OS de 「新規VM」 (nova VM), elektu registritan diskbildon. Eblas ankaŭ krei malplenan VM-on.

La konservoloko estas `%LOCALAPPDATA%\jp.local.hypervstudio\iso-library`. La ISO estas kopiita; la origina dosiero ne estas ŝanĝata. Importado bezonas tiom da libera spaco, kiom okupas la ISO. Diskbildo konektita al VM ne estas forigebla. Por kontroli la konektostaton necesas administraj rajtoj por Hyper-V.

Por VM-oj de la 2-a generacio, Secure Boot estas ŝaltita, kaj la atestila ŝablono estas elektita laŭ la operaciuma tipo (Linux: Microsoft UEFI Certificate Authority / Windows: Microsoft Windows). AlmaLinux 10 subtenas Secure Boot, do la aplikaĵo ne senkondiĉe malŝaltas ĝin ([oficiala klarigo de AlmaLinux](https://almalinux.org/blog/2025-05-27-welcoming-almalinux-10/)). Por ke la VM povu legi la ISO, la aplikaĵo donas al tiu VM legpermeson por la elektita ISO-dosiero.

### Pluraj retadaptiloj

En la retosekcio de nova VM, aldonu NIC-ojn kaj elektu por ĉiu ekzistantan virtualan ŝaltilon de la gastiganto. Unu VM povas havi ĝis 8 NIC-ojn, kaj ĉiu NIC povas esti konektita al malsama ŝaltilo. Eblas ankaŭ lasi NIC-ojn malkonektitaj aŭ krei agordon kun 0 NIC-oj.

NIC-oj estas aldoneblaj ankaŭ al ekzistantaj VM-oj. Faru normalan malŝalton de la VM, atendu ĝis ĝi estas haltigita, elektu ĝin en la listo kaj malfermu 「ネットワーク」 (reto). Per 「＋NIC追加」 (aldoni NIC-on) aldonu vicojn, elektu virtualan ŝaltilon por ĉiu NIC kaj premu 「保存」 (konservi). Por funkcianta VM la retagordoj estas nur legeblaj; por konservi ŝanĝojn necesas haltigi ĝin.

Ĉi tiu operacio ne kreas virtualajn ŝaltilojn, ne agordas NAT en la gastiganto kaj ne agordas vojigon aŭ izolon inter retoj. Antaŭe preparu la bezonatajn retojn en Hyper-V.

### Kloni VM-on

Eblas plurfoje kopii originan VM-on, en kiu la operaciumo estas instalita kaj la bazaj agordoj estas pretaj, al VM-oj kun aliaj nomoj. La origina VM kaj ĝiaj datumoj estas konservataj; la aplikaĵo kreas novan VM-ID kaj sendependajn virtualajn diskojn.

1. Faru normalan malŝalton de la origina VM kaj kontrolu, ke ĝia stato estas 「停止」 (haltigita). VM en konservita aŭ paŭzigita stato ne estas klonebla.
2. Elektu la originan VM-on en la listo kaj premu 「複製」 (kloni) en ĝiaj detaloj.
3. Enigu nomon por la nova VM. Por aŭtomate agordi Linux ĉe ĝia unua ekfunkciigo, unue preparu la originan VM-on kiel priskribite sube, kaj specifu la komputilnomon de la operaciumo per 「OS内部も自動設定」 (ankaŭ aŭtomate agordi la operaciumon).
4. Kontrolu la NIC-ojn kaj iliajn konektojn, elektu ĉu konekti la kopion al la samaj retoj kaj premu 「複製」 (kloni). Tenu la aplikaĵon malfermita ĝis la fino de la operacio.

Klonado kopias ĉiujn NIC-ojn de la origina VM. Se vi elektas 「元と同じネットワークに接続」 (konekti al la samaj retoj kiel la originalo), ĉiu NIC estas konektita al la sama virtuala ŝaltilo kiel en la originalo; originale malkonektitaj NIC-oj restas malkonektitaj. Se vi malŝaltas la opcion, ĉiuj NIC-oj restas malkonektitaj. La kopio ricevas novajn MAC-adresojn.

La klonita VM estas kreata en haltigita stato, kun aŭtomata ekfunkciigo malŝaltita. La origina instalada ISO estas malkonektita de la DVD-legilo de la kopio. Se vi elektas aŭtomatan agordon ene de la operaciumo, anstataŭ ĝi estas konektita ISO `CIDATA` por la unua agordo.

Kun 「OS内部も自動設定」 malŝaltita, eblas kopii la agordojn kaj diskojn sen preparo de ŝablono. Tiam ankaŭ la komputilnomo, IP-agordoj, machine-id, SSH-servilŝlosiloj kaj aliaj agordoj ene de la operaciumo estas kopiitaj. Faru la necesajn ŝanĝojn antaŭ ol konekti la VM-on al reto.

#### Prepari originan Linux-VM-on

Aŭtomata agordo ene de la operaciumo celas AlmaLinux / Rocky Linux / RHEL 9 kaj 10 kaj VM-ojn kun 0–8 NIC-oj. Post la bazaj agordoj, konservu [`src-tauri/scripts/prepare-linux-template.sh`](src-tauri/scripts/prepare-linux-template.sh) ene de la origina Linux-sistemo kaj rulu la jenon por la unua preparo. La skripto ankaŭ estas videbla per 「テンプレートの準備手順」 (instrukcioj por prepari ŝablonon) en la klonofenestro.

```bash
sudo bash prepare-linux-template.sh --shutdown
```

Ĉi tiu skripto instalas `cloud-init` kaj ebligas nur la minimuman aron de moduloj bezonataj por agordi la komputilnomon, SSH-servilŝlosilojn kaj similajn agordojn. Ĝi malŝaltas aŭtomatan konektadon de ekzistantaj Ethernet-konektoprofiloj sen interrompi la nunajn konektojn, por eviti konfliktojn kun la DHCP-agordoj post kopiado. Ĝi konservas la agordojn de uzantoj, pasvortoj kaj SSH-aŭtentikigo, nuligas la rulhistorion kaj malnovajn semdatumojn de cloud-init kaj la machine-id, kaj poste malŝaltas la originan VM-on.

**Post la preparo ne ekfunkciigu la originan VM-on; kopiu ĝin el tiu haltigita stato.** Se vi ekfunkciigas la originan VM-on por ĝisdatigi aŭ reagordi ĝin, rulu la preparskripton denove kaj haltigu ĝin antaŭ ol kopii.

En la klonofenestro, enigu komputilnomon de 1–63 signoj, konsistantan el minusklaj literoj a–z, ciferoj kaj streketoj, kun litero aŭ cifero ĉe la komenco kaj fino. Je la unua ekfunkciigo de la klonita VM, la aplikaĵo aplikas la komputilnomon, novan machine-id, novajn SSH-servilŝlosilojn kaj DHCP-agordojn por la novaj MAC-adresoj de ĉiu NIC. La NIC-oj ene de Linux estas nomataj laŭorde `eth0`–`eth7`, kaj ĉiuj uzas IPv4 DHCP. Por VM kun 0 NIC-oj, la retagordoj restas malplenaj kaj nur la komputilnomo kaj aliaj komencaj agordoj estas aplikataj. La VM-nomo en la aplikaĵo kaj la komputilnomo ene de la operaciumo estas aparte specifeblaj.

Por akiri IP-adreson per DHCP, ĉiu konektita NIC devas povi atingi DHCP-servilon tra sia virtuala ŝaltilo. Konektu ĉiun NIC-on de la origina VM al la bezonata ŝaltilo kaj elektu konekton al la originaj retoj ankaŭ en la klonofenestro. Malkonektitaj NIC-oj kaj retoj sen DHCP-servilo ne ricevos IP-adreson. La ISO por la unua agordo estas kopiita al konservoloko propra al la klonita VM kaj tial ne dependas de la originaj semdatumoj de la aplikaĵo.

Por la kazo, ke pluraj DHCP-serviloj liveras defaŭltajn enirejojn, la NIC-oj ricevas laŭorde vojmetrikojn 100, 200, …, 800. Inter vojoj al la sama celo, la pli malgranda metriko havas prioritaton. Por ke ankaŭ la eligo por NetworkManager de pli malnovaj cloud-init-versioj uzu ĉi tiujn valorojn, la preparskripto konservas NetworkManager-agordojn limigitajn al `eth0`–`eth7`. Ĝi ne aŭtomate generas politik-bazitan vojigon, kian povas bezoni ekzemple agordo akceptanta eksterajn konektojn tra pluraj retoj. [Agordoj de NetworkManager](https://networkmanager.dev/docs/api/latest/NetworkManager.conf.html), [pluraj defaŭltaj enirejoj en RHEL](https://docs.redhat.com/ja/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_networking/how-networkmanager-manages-multiple-default-gateways)

#### Kondiĉoj por klonado kaj bezonata konservospaco

- La VM devas esti haltigita, sen kontrolpunktoj, kaj uzi sendependajn diskojn `.vhd` / `.vhdx`. Post forigo de kontrolpunktoj, atendu ĝis la diskokunfando finiĝas antaŭ ol kloni.
- Ne estas subtenataj diferencaj, komunaj aŭ fizikaj diskoj rekte transdonitaj al la VM; pluraj samnomaj diskdosieroj; vTPM, protektado aŭ ĉifrado; replikado; grapoloj; asignitaj fizikaj aparatoj, GPU-oj aŭ Fibre Channel; konektitaj COM-pordoj; kaj aliaj specialaj agordoj. Se tia agordo estas detektita, la aplikaĵo montras eraron antaŭ klonado.
- La konservoloko estas sub `C:\Virtual Machines`, same kiel por nova VM. Por ĉiu kopio estas kreata aparta dosierujo, kiu enhavas la VM-agordojn kaj virtualajn diskojn. Se ne eblas skribi al la konservoloko, la erarmesaĝo montras ĝian plenan dosiervojon.
- Ĉar eksportado estas sekvata de importado al aparta loko, la operacio provizore bezonas liberan spacon egalan al proksimume duoble la efektiva dosiergrando de la kopiataj virtualaj diskoj, plus la agordodosieroj. La provizora eksportaĵo estas forigata post sukceso.
- Se klonado malsukcesas, la aplikaĵo forigas nur la VM-on kaj la dediĉitan laborareon kreitajn de tiu operacio. Se restas neforigeblaj eroj, ilia konservoloko estas montrata en la erarmesaĝo.

### Sistemaj postuloj

- Windows 11 Pro / Enterprise kun Hyper-V ebligita, aŭ subtenata Windows Server
- La PowerShell-modulo Hyper-V
- Administraj rajtoj en Windows (permesu la UAC-peton je lanĉo kaj, se necese, enigu la akreditaĵojn de administra konto)
- Por evoluigado: Node.js, la Rust MSVC-ilĉeno, Microsoft C++ Build Tools kaj WebView2

### Evoluigado kaj rulado

En Windows, rulu el PowerShell malfermita kun administraj rajtoj.

```powershell
npm ci
npm run tauri dev
```

La Windows-programdosiero enhavas `requireAdministrator` kaj petas administrajn rajtojn ankaŭ ĉe ordinara lanĉo. Lanĉado el la Start-menuo aŭ ŝparvojo montras UAC-peton; post permeso, la aplikaĵo kaj ĝiaj subprocezoj por Hyper-V-operacioj funkcias kun administraj rajtoj. Se vi nuligas la UAC-peton, la aplikaĵo ne lanĉiĝas.

Por konstrui distribueblan version:

```powershell
npm run tauri build
```

#### Instalilo por Windows

La publikigita Windows-instalilo estas elŝutebla de [GitHub Releases](https://github.com/hogehohe/hyperv-studio/releases/latest).

Distribua konstruo generas japanlingvan NSIS-instalan EXE en `src-tauri/target/release/bundle/nsis/`. Ĝi instalas por la nuna uzanto. La aplikaĵo estas lanĉebla el la Start-menuo kaj malinstalebla per la listo de instalitaj aplikaĵoj de Windows.

Se la aplikaĵo jam estas konstruita kaj vi volas rekrei nur la instalilon, rulu:

```powershell
npm run tauri -- bundle --bundles nsis --ci
```

Se WebView2 jam estas instalita, la instalilo uzas tiun rulmedion; alikaze ĝi elŝutas ĝin dum instalado. La ISO-biblioteko kaj VM-diskoj ne estas inkluzivitaj en la instalilo. Por la sama uzantokonto, la aplikaĵo daŭre uzas la ekzistantajn datumojn en `%LOCALAPPDATA%\jp.local.hypervstudio`.

Se dum malinstalado vi elektas 「アプリケーションのデータを削除」 (forigi la datumojn de la aplikaĵo), la ISO-biblioteko kaj aplikaĵaj agordoj ankaŭ estos forigitaj. Ne elektu tion se vi volas konservi la ISO-diskbildojn. La opcio estas defaŭlte malŝaltita.

### Interna funkciado kaj sekurecaj limoj

La fasado vokas fiksajn komandojn por VM-operacioj kaj ISO-administrado per `invoke`. Rust validigas VM-ID-ojn kaj la valorojn por novaj VM-oj, kaj transdonas JSON al PowerShell per mediovariabloj. La enigaĵoj neniam estas enmetataj en la fontkodon de PowerShell. Por ekfunkciigo kaj haltigo, la celon identigas la VM-ID, ne la montrata nomo. ISO-ID estas tradukita al la koncerna konservita dosiero; dum importado, la formato kaj grando estas kontrolataj, kaj la diskbildo estas aldonata al la listo nur post kompleta kopiado.

Se agordo de la CPU aŭ ISO malsukcesas post kreado, la jam kreita VM ne estas aŭtomate forigata. Refreŝigu la interfacon kaj kontrolu ĝian staton.

## 日本語

この PC の Hyper-V 仮想マシンを扱う Windows 向け Tauri アプリです。画面は React / TypeScript、VM 操作は Rust から Windows PowerShell 5.1 の Hyper-V モジュールを呼び出します。

### 初版の機能

- ローカルホストの VM 一覧、検索、状態・構成の表示
- VM の名前変更と、同名 VM の重複チェック
- 停止中 VM の削除と、専用の仮想ディスクを削除するオプション
- VM の起動と保存状態からの再開
- 選択した VM のコンソール画面を「接続」から開く
- 既存 VM の起動順序と、第 2 世代 VM の Secure Boot の有効・無効を変更
- ゲスト OS への通常シャットダウン（強制電源断は行いません）
- 第 1 / 第 2 世代 VM と新規 VHDX の作成、vCPU・メモリ・複数 NIC の接続先・OS イメージの選択
- Hyper-V の管理権限がない場合のエラー表示
- 「設定 → 外観」からライト / ダーク / システムに合わせるを選択し、次回起動時にも保持
- 「設定 → OSイメージ」から ISO をアプリのデータ領域へ取り込み、OS 名と種類を付けて管理
- 停止中の VM を別名で複製し、準備済みの Linux では OS 内部のホスト名と DHCP も設定

### 新規 VM の既定値

| 項目 | 既定値 |
| --- | --- |
| 起動メモリ | 8 GiB（8192 MiB / 8,589,934,592 バイト） |
| 仮想ディスク容量 | 200 GiB（214,748,364,800 バイト） |
| 世代 | 第 2 世代 |
| vCPU | 2 個 |
| VM 構成の保存先 | `C:\Virtual Machines\<VM名>` |
| 仮想ディスク | `C:\Virtual Machines\<VM名>\<VM名>.vhdx` |
| 起動デバイス | ISO あり: DVD → VHD、ISO なし: VHD を優先 |
| 構成バージョン | 12.0 |

新規作成画面ではメモリ・ディスク容量・世代・vCPU を変更できます。仮想ディスクは動的拡張方式で、200 GiB は最大容量です。構成バージョン 12.0 をホストがサポートしているか、作成前に確認します。既存の同名フォルダーやディスクがある場合は上書きせず、エラーを表示します。既存 VM と Hyper-V ホストの既定の保存先は変更しません。

ISO を指定した場合は DVD ドライブに接続し、DVD → 仮想ハードディスク → その他の起動デバイスの順にします。ISO を指定しない空 VM と複製 VM は仮想ハードディスクを優先します。OS のインストール自体はこの初版では自動化していません。インストール完了後は、ISO を取り外すか Hyper-V の設定で仮想ハードディスクを優先してください。

### VM の画面を開く

一覧で VM を選び、詳細の「接続」を押すと、Windows 標準の「仮想マシン接続」（VMConnect）が別ウィンドウで開きます。「起動」は VM の電源操作、「接続」はコンソールを開く操作です。停止中・実行中・保存状態・一時停止中の VM でも接続画面を開けます。

接続には Hyper-V の管理権限と Windows の `vmconnect.exe` が必要です。接続画面を閉じても VM は動作を続けます。

### 既存 VM の起動設定

VM を選び、詳細の「起動設定」を開きます。第 2 世代 VM では Secure Boot の有効・無効を切り替えられます。現在の証明書テンプレートを表示し、有効・無効を変更してもテンプレートは保持します。

起動項目は上から順に試されます。「上へ」「下へ」で、仮想ディスク、DVD、ネットワーク、OS の起動エントリーなどを並べ替えます。起動項目の追加・削除は行いません。第 1 世代 VM は BIOS の起動順序のみ変更でき、Secure Boot には対応していません。

保存できるのは停止状態の VM です。実行中・保存状態・一時停止中は閲覧のみとなり、アプリが自動的に VM を停止することはありません。画面を開いた後に別のツールや OS が設定・起動項目を変更した場合は、保存を中止します。「再取得」から最新の構成を読み込んで編集してください。

### VM の名前変更

一覧から VM を選び、詳細にある名前の横の鉛筆ボタンから新しい名前を入力して保存します。実行中の VM でも変更できます。同じ名前の別 VM がある場合は保存できません。Hyper-V 上の表示名を変更する操作で、ゲスト OS のホスト名や仮想ディスクのファイル名は変更しません。

### VM の削除

停止中の VM を選び、詳細の下部にある「VMを削除」を押します。表示された対象とディスクのパスを確認し、確認欄へ VM 名を大文字・小文字も含めて入力します。「仮想ディスクも削除」を選んだ場合は、表示されたディスクも削除します。初期状態ではディスクを残す設定です。削除は元に戻せません。

ディスク削除は、独立したローカルの `.vhd` / `.vhdx` ファイルを対象にします。共有・差分・ホストにマウント中のディスク、チェックポイントがある構成、他の登録済み VM・チェックポイントのディスクやその親ディスクから参照されるファイル、リンクを含むパスなど、確認できない構成ではディスク削除を無効にします。未登録の VM や保管中の差分ディスクからの参照までは検出できないため、再利用するディスクは残してください。

VM の登録だけを削除する場合、Hyper-V は構成ファイルを削除して仮想ディスクを残します。チェックポイントがある場合は、Hyper-V により削除・統合が行われます（[Microsoft の Remove-VM の仕様](https://learn.microsoft.com/en-us/powershell/module/hyper-v/remove-vm)）。ディスクも削除する処理で一部のファイルを削除できなかった場合は、登録削除が完了したことと、残ったファイルのパスを画面に表示します。

### OS イメージの管理

1. 「設定 → OSイメージ → ISOを選択」で手元の ISO を選びます。
2. OS 名と種類（Windows / Linux / その他）を確認して「取り込む」を押します。コピーの進捗が表示されます。
3. 「新規VM」の OS 欄から登録済みイメージを選びます。空の VM も作成できます。

保存先は `%LOCALAPPDATA%\jp.local.hypervstudio\iso-library` です。ISO はコピーされ、元のファイルは変更しません。登録には ISO と同じ容量の空き領域が必要です。VM が接続中のイメージは削除できません。接続状態の確認には Hyper-V の管理権限が必要です。

第 2 世代 VM の Secure Boot は有効にし、選択した OS の種類に合わせて証明書を設定します（Linux: Microsoft UEFI Certificate Authority / Windows: Microsoft Windows）。AlmaLinux 10 は Secure Boot に対応しているため、一律に無効化はしません（[AlmaLinux の公式説明](https://almalinux.org/blog/2025-05-27-welcoming-almalinux-10/)）。VM が ISO を読み取れるよう、選択した ISO ファイルにその VM の読み取り権限を付けます。

### 複数のネットワークアダプター

新規 VM のネットワーク欄で NIC を追加し、それぞれの接続先をホスト上の既存の仮想スイッチから選びます。1 台の VM に最大 8 個の NIC を設定でき、NIC ごとに別のスイッチへ接続できます。NIC を接続しない構成や、NIC が 0 個の構成も選べます。

既存 VM にも NIC を追加できます。VM をシャットダウンして停止し、一覧から選択して「ネットワーク」を開きます。「＋NIC追加」で行を増やし、各 NIC の仮想スイッチを選んで「保存」を押してください。稼働中の VM はネットワーク構成の閲覧のみで、変更を保存するには停止が必要です。

仮想スイッチの作成、ホストの NAT 設定、ネットワーク間のルーティングや分離設定はこの操作では行いません。必要なネットワークは Hyper-V 側であらかじめ準備してください。

### VM の複製

OS のインストールと基本設定を済ませた origin VM を、別の名前の VM として繰り返しコピーできます。元 VM とそのデータは削除せず、新しい VM ID と独立した仮想ディスクを作成します。

1. 元 VM を通常のシャットダウンで停止し、状態が「停止」になったことを確認します。保存状態や一時停止では複製できません。
2. 一覧から元 VM を選び、詳細の「複製」を押します。
3. 複製先の VM 名を入力します。Linux の初回設定を行う場合は、後述の origin 準備を済ませ、「OS内部も自動設定」で OS のホスト名を指定します。
4. 元 VM の NIC と接続先を確認し、元と同じネットワークへ接続するかを選んで「複製」を押します。完了するまでアプリを開いておきます。

複製では元 VM の NIC をすべて引き継ぎます。「元と同じネットワークに接続」を選ぶと、各 NIC をそれぞれ元と同じ仮想スイッチへ接続し、元から未接続だった NIC は未接続のままにします。オフにすると全 NIC を未接続にします。複製側には新しい MAC アドレスを設定します。

複製した VM は停止状態で作成し、自動起動を無効にします。元のインストール ISO は複製側の DVD ドライブから外します。OS 内部の自動設定を選んだ場合は、代わりに初回設定用の `CIDATA` ISO を複製側へ接続します。

「OS内部も自動設定」をオフにすると、テンプレート準備なしで構成とディスクをコピーできます。この場合、OS 内部のホスト名・IP 設定・machine-id・SSH ホスト鍵なども引き継ぎます。必要な変更を済ませてからネットワークに接続してください。

#### Linux の origin を準備する

OS 内部の自動設定は、AlmaLinux / Rocky Linux / RHEL の 9・10 と、NIC が 0〜8 個の VM を対象にしています。基本設定を済ませた origin の Linux 内へ [`src-tauri/scripts/prepare-linux-template.sh`](src-tauri/scripts/prepare-linux-template.sh) を保存し、初回に次を実行します。複製画面の「テンプレートの準備手順」からもスクリプトを確認できます。

```bash
sudo bash prepare-linux-template.sh --shutdown
```

このスクリプトは `cloud-init` をインストールし、ホスト名と SSH ホスト鍵などの設定に必要な最小限のモジュールだけを有効にします。既存の Ethernet 接続プロファイルは現在の接続を切らずに自動接続を無効化し、コピー後の DHCP 設定との競合を防ぎます。ユーザー・パスワード・SSH の認証設定を引き継ぎ、cloud-init の実行履歴と古いシード、machine-id を初期化した後、origin をシャットダウンします。

**準備後は origin を起動せず、その停止状態からコピーしてください。** origin を起動して更新・再設定した場合は、再びこの準備スクリプトを実行して停止してからコピーします。

複製画面では、OS のホスト名を 1〜63 文字の小文字英数字とハイフンで入力し、先頭・末尾を英数字にします。複製した VM の初回起動時にホスト名、新しい machine-id、SSH ホスト鍵、各 NIC の新しい MAC アドレスに対応する DHCP 設定を適用します。Linux 内の NIC 名は順に `eth0`〜`eth7` となり、全 NIC で IPv4 DHCP を使います。NIC が 0 個の場合はネットワーク設定を空にして、ホスト名などの初期設定だけを行います。アプリ上の VM 名と OS 内部のホスト名は別々に指定できます。

DHCP で IP アドレスを取得するには、接続する各 NIC の仮想スイッチから DHCP サーバーへ到達できる必要があります。origin の各 NIC を必要なスイッチに接続しておき、複製画面でも元のネットワークへ接続する設定を選んでください。未接続の NIC や DHCP サーバーのないネットワークでは、IP アドレスは取得できません。初回設定用 ISO は複製 VM 専用の保存先へコピーされるため、元のアプリ内シードに依存しません。

複数の DHCP サーバーからデフォルトゲートウェイが配布される場合に備え、NIC の順に経路メトリックを 100、200、…、800 とします。同じ宛先への経路では小さいメトリックを優先します。古い cloud-init の NetworkManager 出力でもこの既定値が使われるよう、準備スクリプトは `eth0`〜`eth7` に限定した NetworkManager 設定を保存します。複数のネットワークから外部接続を受ける構成などで必要になるポリシールーティングは自動生成しません。[NetworkManager の設定](https://networkmanager.dev/docs/api/latest/NetworkManager.conf.html)、[RHEL の複数デフォルトゲートウェイ](https://docs.redhat.com/ja/documentation/red_hat_enterprise_linux/10/html/configuring_and_managing_networking/how-networkmanager-manages-multiple-default-gateways)

#### 複製の条件と保存領域

- チェックポイントがない、独立した `.vhd` / `.vhdx` を使用する停止中の VM が対象です。チェックポイントを削除した場合は、ディスク統合が完了してから複製します。
- 差分・共有・物理パススルーディスク、同名ディスクファイルが複数ある構成、vTPM・保護・暗号化、レプリカ、クラスタ、物理デバイス・GPU・Fibre Channel の割り当て、接続先のある COM ポートなどの特殊構成には対応していません。検出した場合は複製前にエラーを表示します。
- 保存先は新規作成と同じ `C:\Virtual Machines` 配下です。複製ごとに固有のフォルダーを作り、VM 構成と仮想ディスクをまとめて保存します。保存先へ書き込めない場合は、そのフルパスを含むエラーを表示します。
- エクスポート後に別領域へインポートするため、一時的にコピー対象の仮想ディスクの実ファイル容量の約 2 倍と構成ファイル分の追加空き領域が必要です。完了後は一時エクスポートを削除します。
- 複製の途中で失敗した場合は、その操作で作成した VM と専用作業領域だけを後片付けします。後片付けできない項目が残った場合は、画面のエラーに保存先を表示します。

### 必要な環境

- Hyper-V が有効な Windows 11 Pro / Enterprise、または対応する Windows Server
- Hyper-V PowerShell モジュール
- Windows の管理者権限（アプリ起動時の UAC で許可、必要に応じて管理者アカウントの資格情報を入力）
- 開発時は Node.js、Rust MSVC ツールチェーン、Microsoft C++ Build Tools、WebView2

### 開発・実行

Windows では、管理者権限で開いた PowerShell から実行します。

```powershell
npm ci
npm run tauri dev
```

Windows 版の実行ファイルには `requireAdministrator` を組み込み、通常の起動でも管理者権限を要求します。スタートメニューやショートカットから起動すると UAC が表示され、許可後にアプリと Hyper-V 操作用の子プロセスが管理者権限で動作します。UAC をキャンセルした場合は起動しません。

配布用ビルド:

```powershell
npm run tauri build
```

#### Windows インストーラー

配布済みの Windows 用インストーラーは [GitHub Releases](https://github.com/hogehohe/hyperv-studio/releases/latest) からダウンロードできます。

配布用ビルドでは、日本語の NSIS セットアップ EXE を `src-tauri/target/release/bundle/nsis/` に生成します。現在のユーザー向けにインストールし、スタートメニューと Windows のインストール済みアプリから起動・アンインストールできます。

アプリ本体をビルド済みで、インストーラーだけを作り直す場合は次を実行します。

```powershell
npm run tauri -- bundle --bundles nsis --ci
```

WebView2 が導入済みの場合はそのランタイムを使用し、未導入の場合はセットアップ中にダウンロードします。ISO ライブラリや VM のディスクはインストーラーに含めません。同じアカウントでは、既存の `%LOCALAPPDATA%\jp.local.hypervstudio` のデータを引き続き使用します。

アンインストール時の「アプリケーションのデータを削除」を選ぶと、ISO ライブラリとアプリ設定も削除されます。ISO を保持する場合は選ばないでください。この項目は初期状態ではオフです。

### 仕組みと安全上の境界

フロントエンドは `invoke` で VM 操作と ISO 管理の固定コマンドを呼び出します。Rust は VM ID と新規作成の値を検証し、PowerShell に JSON を環境変数で渡します。入力を PowerShell のソースコードへ埋め込む処理はありません。起動・停止は表示名ではなく VM ID で対象を特定します。ISO は ID から保存済みファイルへ解決し、取り込み時には形式とサイズを検証して、コピー完了後に一覧へ登録します。

作成後の CPU や ISO 設定で失敗した場合、作成済み VM を自動削除しません。画面を更新して状態を確認してください。
