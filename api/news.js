import { fetchStockNews } from "../engine/newsCheck.js";
import { isValidTicker } from "../utils/validator.js";

export default async function handler(req, res) {

  try {

    const kode = (req.query.kode || "").toUpperCase().trim();

    if (!kode) {
      return res.status(400).json({
        success: false,
        message: "Kode saham wajib diisi."
      });
    }

    if (!isValidTicker(kode)) {
      return res.status(400).json({
        success: false,
        message: "Kode saham tidak valid (contoh: BBCA)."
      });
    }

    const hasil = await fetchStockNews(kode);

    return res.status(200).json({
      success: true,
      data: hasil
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      success: false,
      message: "Gagal mengambil berita.",
      error: error.message
    });

  }

}
