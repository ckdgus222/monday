// api/webhook.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // ✅ raw body 읽기
  const buf = await new Promise((resolve) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data || ""));
  });

  // ✅ challenge 검증 요청 처리
  const match = buf.match(/"challenge"\s*:\s*"([^"]+)"/);
  if (match) {
    const challenge = match[1];
    console.log("✅ Challenge 감지:", challenge);

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Length", Buffer.byteLength(buf, "utf8"));
    res.setHeader("Connection", "close");
    return res.status(200).send(buf);
  }

  // ✅ 일반 이벤트: Express로 포워딩
  try {
    const TARGET = process.env.TARGET_URL; // ngrok 주소 넣을 곳
    if (TARGET) {
      await fetch(TARGET, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: buf,
      });
    }
  } catch (err) {
    console.error("❌ 포워딩 실패:", err.message);
  }

  res.status(200).send("ok");
}
