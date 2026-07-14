// ==========================
// Universe Emiten IDX (dengan tag sektor)
// ==========================
//
// Sumber tunggal daftar kode saham untuk batch scanner (api/scan.js).
// CATATAN: ini BUKAN daftar resmi lengkap ~951 emiten IDX — IDX & dataset
// publik memblokir akses otomatis dari sistem ini, jadi daftar ini
// dikompilasi dari pengetahuan umum kode saham IDX yang sudah dikenal
// luas. Aman dipakai untuk scanning karena semua filter (harga, volume,
// sinyal) tetap dicek LIVE lewat data candle saat scan berjalan, bukan
// dari daftar ini. Disarankan cek berkala ke
// idx.co.id/id/data-pasar/data-saham/daftar-saham untuk menambah kode
// baru (IPO) atau membuang yang delisting.
//
// Tag sektor dipakai untuk menghitung Relative Strength saham vs
// rata-rata sektornya (lihat engine/relativeStrength.js) — dihitung
// dari data batch itu sendiri, bukan indeks sektor eksternal terpisah.

export const SECTOR_UNIVERSE = {
  "Konstruksi & Properti": [
    "WIKA","WSKT","ADHI","PTPP","WEGE","TOTL","NRCA","ACST","WTON",
    "BSDE","PWON","SMRA","APLN","KIJA","BEST","DMAS","MTLA","GPRA",
    "ASRI","BKSL","DILD","MDLN","PPRO","CITY","CSIS","NIRO","OMRE",
    "LPKR","LAND","PURI","ARMY","LCGP","MTSM","SMDM","RDTX",
    "CTRA","PANI","DUTI","JRPT","KOTA"
  ],
  "Tambang & Energi": [
    "DOID","BSSR","MBAP","TOBA","GEMS","INDY","ELSA","ENRG","RUIS",
    "ESSA","MEDC","BUMI","DEWA","BIPI","APEX","MYOH","GTBO","PKPK",
    "ATPK","BOSS","ABMM","RMKE","RAJA","PGAS","AKRA","PTRO",
    "KKGI","ITMG","HRUM","SMMT","SQMI",
    "ADRO","PTBA","ANTM","INCO","TINS"
  ],
  "Perbankan & Keuangan": [
    "BJTM","BJBR","BBTN","BEKS","BABP","BBHI","BNBA","BMAS","AGRO",
    "BVIC","INPC","MAYA","NOBU","PNBN","BSIM","BANK","BACA",
    "BBYB","DNAR","MCOR","SDRA",
    "BFIN","ADMF","WOMF","MFIN","IBFN","VRNA","TRUS","YULE",
    "BBCA","BBRI","BMRI","BBNI","BDMN","BNGA","BNLI","BTPN","BTPS",
    "MEGA","NISP","ARTO","AMAR","BNII"
  ],
  "Retail, Konsumer & Media": [
    "RALS","ACES","ERAA","MPPA","HERO","RANC","MNCN","SCMA","MSKY",
    "VIVA","FILM","FORU","TMPO","KIOS","SOHO","TELE","PGLI",
    "BOGA","CSAP","ECII","KONI","LMSH","LUCK","MAPI","MIDI",
    "PMJS","SONA","TRIO"
  ],
  "Consumer Goods": [
    "CLEO","GOOD","HOKI","PCAR","ROTI","SKLT","STTP",
    "ULTJ","CEKA","FOOD","CAMP","PSDN","BTEK",
    "UNVR","ICBP","INDF","GGRM","HMSP","MYOR","SIDO","CMRY","AMRT",
    "LPPF","MAPA","MAPB","MAIN","TAPG"
  ],
  "Pelayaran & Logistik": [
    "TMAS","SMDR","WINS","HITS","BULL","TPMA",
    "NELY","SAFE","SAPX","IPCC","CASS","KARW",
    "MIRA","LRNA","SOCI","WEHA","HELI","BPTR","JSMR"
  ],
  "Perkebunan": [
    "LSIP","SGRO","SIMP","DSNG","TBLA",
    "ANJT","PALM","GZCO","JAWA","BWPT",
    "AALI","SSMS","TLDN"
  ],
  "Farmasi & Kesehatan": [
    "KAEF","INAF","PEHA","PRDA",
    "HEAL","MIKA","SILO","SRAJ","CARE",
    "DVLA","MERK","TSPC","TCID","SCPI","KLBF"
  ],
  "Teknologi": [
    "DIVA","MCAS","CYBR","EDGE",
    "GOTO","BUKA","RUNS","GLVA","ZYRX","TFAS",
    "EMTK","DCII"
  ],
  "Industri & Manufaktur": [
    "MARK","TRST","IKAI","KICI","SSTM",
    "ARGO","ESTI","STAR","LPIN","IMAS",
    "ALDO","BTON","ARNA","AMFG","CTBN",
    "IKBI","JECC","EKAD","SBMA","FPNI",
    "UNTR","CPIN","JPFA","SMGR","INTP","TOWR","TBIG","MTEL","TPIA","BRPT",
    "INKP","TKIM","FASW","SPMA","AGII","BUDI","UNIC"
  ],
  "Logam & Baja": [
    "KRAS","NIKL","INAI","BAJA","ALKA","ISSP"
  ],
  "Tekstil": [
    "PBRX","RICY","SRIL","INDR","POLY"
  ],
  "Telekomunikasi": [
    "LINK","ISAT","EXCL","FREN","MTDL","TLKM"
  ],
  "Perikanan": [
    "CPRO","DSFI","IIKP"
  ],
  "Pariwisata, Hotel & Hiburan": [
    "FAST","ICON","JIHD","PUDP","SHID",
    "PANR","PDES","PZZA","JGLE","BAYU"
  ],
  "Asuransi": [
    "ASBI","ASDM","ASJT","ASMI","LPGI","MREI","PNIN","PNLF","VINS",
    "AHAP","TUGU","JMAS"
  ],
  "Blue Chip / Lintas Sektor": [
    "TLKM","ASII"
  ],
  "Lainnya": [
    "ABBA","BELL","KREN","MAMI","POOL","TRUE","UFOE","WOOD"
  ]
};

// Peta kode -> sektor (dipakai untuk relative strength vs sektor).
// Kalau satu kode muncul di lebih dari satu grup sektor, grup pertama
// yang menang (menghindari duplikasi sekaligus tetap deterministik).
export const SECTOR_MAP = {};
for (const [sector, codes] of Object.entries(SECTOR_UNIVERSE)) {
  for (const kode of codes) {
    if (!(kode in SECTOR_MAP)) {
      SECTOR_MAP[kode] = sector;
    }
  }
}

// Daftar kode unik (deduplikasi lintas sektor), dipakai sebagai
// universe utama untuk batch scanner.
export const UNIVERSE = Array.from(new Set(Object.keys(SECTOR_MAP))).sort();

export function getSector(kode) {
  return SECTOR_MAP[kode] || "Lainnya";
}

export default UNIVERSE;
