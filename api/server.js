import express from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

// ✅ Challenge 응답 함수 (로그 찍기 버전)
function replyChallenge(res, challenge) {
  const body = Buffer.from(String(challenge), "utf8");
  const headers = {
    "Content-Type": "text/plain",
    "Content-Length": body.length,
    Connection: "close",
  };

  console.log("📤 [DEBUG] Monday로 보낼 응답 헤더:", headers);
  console.log("📤 [DEBUG] Monday로 보낼 응답 본문:", body.toString());

  res.writeHead(200, headers);
  res.end(body);
}

// ✅ 루트 핸들러
app.get("/", (_, res) => res.send("✅ Express OK"));

// ✅ Webhook 엔드포인트
app.post("/monday-webhook", async (req, res) => {
  try {
    console.log(
      "📥 /monday-webhook 요청 수신:",
      JSON.stringify(req.body, null, 2)
    );

    // 🔹 Challenge 요청 처리
    if (req.body?.challenge) {
      console.log("✅ Challenge 요청 감지됨:", req.body.challenge);
      return replyChallenge(res, req.body.challenge);
    }

    // 🔹 일반 이벤트 처리
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");

    const event = req.body?.event;
    const status = event?.value?.label?.text;
    const phone = event?.pulseName;

    if (status === "수리 완료") {
      console.log(`📦 상태 변경 감지 → ${status} (${phone})`);
      await sendToGoogleSheets({ phone, status });
    }
  } catch (err) {
    console.error("❌ Webhook 처리 오류:", err);
    try {
      res.status(200).end("ok");
    } catch {}
  }
});

// ✅ Google Sheets 테스트용 함수
async function sendToGoogleSheets(data) {
  if (!process.env.SHEET_API_URL) return console.log("⚠️ SHEET_API_URL 없음");
  try {
    const res = await axios.post(process.env.SHEET_API_URL, data);
    console.log("📊 시트 저장 결과:", res.data);
  } catch (err) {
    console.error("📉 시트 저장 실패:", err.message);
  }
}

// ✅ 서버 시작
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 서버 실행 중: http://localhost:${PORT}`)
);
