async function analisa(){

const kode=document
.getElementById("kode")
.value
.toUpperCase();

const hasil=document
.getElementById("hasil");

hasil.innerHTML="Loading...";

try{

const res=await fetch(
"https://saham-ai-vercel-six.vercel.app/api/analyze?kode="+kode
);

const json=await res.json();

const d=json.data;

hasil.innerHTML=`

<div class="card">

<h2>${d.kode}</h2>

<p><b>Harga :</b> ${d.close}</p>

<p><b>Signal :</b>

<span class="good">

${d.signal}

</span>

</p>

<p><b>Score :</b> ${d.score}</p>

<p><b>Confidence :</b> ${d.confidence}%</p>

<p><b>Rating :</b> ${d.rating}</p>

<p><b>Trend :</b> ${d.marketTrend}</p>

<p><b>Momentum :</b> ${d.momentum.strength}</p>

<p><b>Gap :</b> ${d.gap.probability}</p>

<p><b>Verdict :</b>

${d.verdict}

</p>

</div>

`;

}catch(e){

hasil.innerHTML="Gagal mengambil data.";

}

}