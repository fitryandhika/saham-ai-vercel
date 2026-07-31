import { fetchMarketNews } from "../services/marketNewsService.js";

export default async function handler(req, res) {
  try {
    const items = await fetchMarketNews();

    return res.status(200).json({
      success: true,
      data: items
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil berita pasar.",
      error: error.message
    });
  }
}
