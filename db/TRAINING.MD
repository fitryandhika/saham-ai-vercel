Cara Pakai: Data Logging & Training Model
1. Setup Supabase (sekali saja, ~5 menit dari HP)
Buka supabase.com → daftar/login → New Project (pilih region Singapore biar latensi ke Vercel/Yahoo rendah).
Setelah project jadi, buka SQL Editor → New query → paste seluruh isi db/schema.sql → Run. Ini bikin tabel scan_history.
Buka Project Settings → API. Catat 2 nilai:
Project URL → ini SUPABASE_URL
service_role key (bagian Project API keys, BUKAN anon key) → ini SUPABASE_SERVICE_KEY
Di Vercel: buka project kamu → Settings → Environment Variables → tambahkan SUPABASE_URL dan SUPABASE_SERVICE_KEY dengan nilai di atas → Save → redeploy.
service_role key itu setara akses admin ke database kamu — jangan pernah ditaruh di kode frontend (script.js) atau di-commit ke GitHub. Cukup di Environment Variables Vercel saja.
2. Biarkan data terkumpul otomatis
vercel.json sudah didaftarkan 2 cron job (Hobby plan cukup, keduanya 1x/hari):
09:30 UTC (16:30 WIB), setelah market tutup → /api/scan jalan, menyimpan snapshot fitur SEMUA emiten ke scan_history.
02:15 UTC (09:15 WIB), setelah market besok buka → /api/label-outcomes jalan, mengisi kolom hasil aktual (open besok, apakah gap-up terjadi) untuk snapshot kemarin.
Timing cron di Hobby plan tidak presisi (bisa meleset dalam jam yang sama), tapi untuk data harian itu tidak masalah.
Tunggu minimal 4-8 minggu (lebih lama lebih baik) sebelum training — dataset yang terlalu kecil (<500 baris) gampang overfit dan hasil evaluasinya tidak bisa dipercaya.
Cek progres kapan saja lewat SQL Editor Supabase:
select count(*) total, count(gap_up_realized) sudah_dilabel
from scan_history;
3. Training di Google Colab (dari HP, tidak perlu laptop)
Buka colab.research.google.com → New notebook → paste kode di bawah ke beberapa cell → jalankan (▶) satu-satu.
Cell 1 — install & konek ke Supabase:
!pip install -q supabase pandas scikit-learn xgboost matplotlib

from supabase import create_client

SUPABASE_URL = "https://xxxxx.supabase.co"       # ganti dengan punya kamu
SUPABASE_KEY = "service_role_key_kamu"            # ganti — JANGAN share notebook ini ke publik

sb = create_client(SUPABASE_URL, SUPABASE_KEY)
Cell 2 — tarik semua data yang sudah dilabel:
import pandas as pd

rows = []
page = 0
while True:
    res = sb.table("scan_history") \
        .select("*") \
        .not_.is_("gap_up_realized", "null") \
        .order("scan_date") \
        .range(page * 1000, page * 1000 + 999) \
        .execute()
    if not res.data:
        break
    rows.extend(res.data)
    page += 1

df = pd.DataFrame(rows)
print(df.shape)
df.head()
Cell 3 — siapkan fitur & target:
FEATURES = [
    "score", "rsi", "macd", "risk_reward", "atr",
    "breakout_distance_pct", "closing_strength",
    "volume_ratio", "volume_accel_slope_pct",
    "rs_vs_ihsg", "rs_vs_sector", "gap_probability"
]

# breakout_level & signal itu kategorikal -> one-hot
df_model = pd.get_dummies(df, columns=["breakout_level", "signal", "rs_label"])

feature_cols = FEATURES + [c for c in df_model.columns if c.startswith(
    ("breakout_level_", "signal_", "rs_label_")
)]
feature_cols = [c for c in feature_cols if c in df_model.columns]

X = df_model[feature_cols].fillna(0)
y = df_model["gap_up_realized"].astype(int)

print("Positive rate (gap-up terjadi):", y.mean().round(3))
Cell 4 — split berdasarkan WAKTU (bukan acak!):
df_model = df_model.sort_values("scan_date")
split_idx = int(len(df_model) * 0.8)

X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]

print(f"Train: {len(X_train)} baris ({df_model.scan_date.iloc[0]} s/d {df_model.scan_date.iloc[split_idx-1]})")
print(f"Test:  {len(X_test)} baris ({df_model.scan_date.iloc[split_idx]} s/d {df_model.scan_date.iloc[-1]})")
Cell 5 — training & evaluasi:
from xgboost import XGBClassifier
from sklearn.metrics import classification_report, roc_auc_score

model = XGBClassifier(
    n_estimators=200, max_depth=4, learning_rate=0.05,
    eval_metric="logloss", random_state=42
)
model.fit(X_train, y_train)

pred = model.predict(X_test)
proba = model.predict_proba(X_test)[:, 1]

print(classification_report(y_test, pred))
print("AUC:", roc_auc_score(y_test, proba).round(3))
Cell 6 — feature importance (bandingkan dengan bobot manual di scorer.js):
import matplotlib.pyplot as plt

importance = pd.Series(model.feature_importances_, index=feature_cols).sort_values()
importance.tail(15).plot.barh(figsize=(8,6))
plt.title("Fitur paling berpengaruh terhadap gap-up")
plt.show()
Cell 7 (opsional, paling penting) — simulasi profit, bukan cuma akurasi:
# Bandingkan: kalau cuma beli saham yang model prediksi gap-up dengan
# confidence tinggi, berapa rata-rata return-nya di data test?
df_test = df_model.iloc[split_idx:].copy()
df_test["pred_proba"] = proba

threshold = 0.6
picked = df_test[df_test.pred_proba >= threshold]

print(f"Model pilih {len(picked)} dari {len(df_test)} kandidat di periode test")
print(f"Rata-rata return next-day: {picked.next_day_return_pct.mean():.2f}%")
print(f"Win rate (return > 0): {(picked.next_day_return_pct > 0).mean():.1%}")

# Baseline pembanding: highConviction filter yang sudah ada di api/scan.js
baseline = df_test[df_test.signal.isin(["BUY", "STRONG BUY"])]
print(f"\nBaseline (signal BUY/STRONG BUY saja): {len(baseline)} kandidat")
print(f"Rata-rata return next-day: {baseline.next_day_return_pct.mean():.2f}%")
4. Setelah model bagus — cara pakainya
Jangan langsung ganti sistem yang sekarang. Urutan yang aman:
Jalankan Cell 7 di atas tiap minggu dengan data test terbaru — kalau model konsisten mengalahkan baseline highConviction selama beberapa minggu berturut-turut, baru pertimbangkan tahap berikut.
Kalau mau dipakai live: model XGBoost bisa di-export (model.save_model("model.json")) lalu di-deploy sebagai endpoint inference terpisah (mis. Modal, Railway, atau Cloud Run — Vercel serverless JS tidak bisa jalankan XGBoost Python secara native). analyzeStock() di engine/analyzer.js tinggal panggil endpoint itu sebagai fitur tambahan, bukan pengganti — biar tetap ada fallback kalau endpoint model down.
Terus kumpulkan data & retrain berkala (mis. tiap bulan) — pasar berubah rezim, model yang bagus bulan ini belum tentu bagus 6 bulan lagi.