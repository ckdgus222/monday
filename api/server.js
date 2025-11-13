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
    const event = req.body?.event;
    const label = event?.value?.label;
    const status = label?.text;
    const isDone = label?.is_done === true;
    const itemId = event?.pulseId;
    const phoneColumnId = "phone_mkxndszs";

    if (isDone || status === "완료" || status === "수리 완료") {
      let normalizedPhone = "";
      try {
        const phoneRaw = await getPhoneNumber(itemId, phoneColumnId);
        console.log("📞 가져온 전화번호:", phoneRaw);
        normalizedPhone = String(phoneRaw || "").replace(/\D/g, "");
      } catch (e) {
        console.error("get phone error:", e?.response?.data || e?.message || e);
      }

      // [ADD] ───────── 문자 발송 블록 ─────────
      try {
        let to = normalizedPhone;
        if (!to || to.length < 10 || to.length > 11) {
          const fallback = (process.env.TEST_SMS_TO || "").replace(/\D/g, "");
          to = fallback || "";
        }
        if (to) {
          console.log("📨 문자 발송 시도:", to);
          const r = await sendAligoSMS(to, "수리가 완료되었습니다.");
          console.log("📨 [알리고] 응답:", r);
        } else {
          console.log("⏸ 문자 스킵(유효 번호 없음)");
        }
      } catch (e) {
        console.error("sms error:", e?.response?.data || e?.message || e);
      }
      // [ADD] ───────── 문자 발송 블록 끝 ─────────

      try {
        const phoneForSheet = normalizedPhone ? "'" + normalizedPhone : "";
        await sendToGoogleSheets({
          phone: phoneForSheet,
          smsPhone: normalizedPhone,
          status,
        });
      } catch (e) {
        console.error(
          "sheets error:",
          e?.response?.data || e?.message || e
        );
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("❌ Webhook 처리 오류:", err);
    try {
      res.status(200).end("ok");
    } catch {}
  }
});

// ✅ Google Sheets 테스트용 함수
async function sendToGoogleSheets(data) {
  const url = process.env.APPS_SCRIPT_WEBHOOK_URL || process.env.SHEET_API_URL;
  if (!url) return console.log("❌ Apps Script URL 없음");
  try {
    console.log("📡 AppsScript로 전송:", data);
    const res = await axios.post(url, data, {
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
    const text = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
    console.log("📡 AppsScript 응답:", text);
    if (!text || !/\bOK\b/i.test(text)) {
      throw new Error(`Sheets non-OK response: ${text}`);
    }
  } catch (err) {
    console.error("📉 시트 저장 실패:", err?.response?.data || err?.message || err);
  }
}

// [ADD] 알리고 문자 발송 함수
async function sendAligoSMS(to, message) {
  const key = process.env.ALIGO_KEY;
  const userId = process.env.ALIGO_USER_ID || process.env.ALIGO_ID;
  const sender = process.env.ALIGO_SENDER;
  const apiUrl = process.env.ALIGO_API_URL || "https://apis.aligo.in/send/";
  const test = process.env.ALIGO_TEST_YN || "N";
  if (!key || !userId || !sender) throw new Error("ALIGO env missing");

  const params = new URLSearchParams();
  params.append("key", key);
  params.append("user_id", userId);
  params.append("sender", sender);
  params.append("receiver", to);
  params.append("msg", message);
  params.append("msg_type", "SMS");
  params.append("testmode_yn", test);

  const res = await axios.post(apiUrl, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    timeout: 10000,
    validateStatus: () => true,
  });

  let data = res.data;
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch {}
  }
  const code = String(data?.result_code ?? "");
  if (code && code !== "1") {
    throw new Error(`Aligo error: ${code} ${data?.message || ""}`);
  }
  return data; // { result_code, message, ... }
}

async function getPhoneNumber(itemId, columnId) {
  try {
    const token = process.env.MONDAY_API_KEY;
    if (!token) {
      console.warn("⚠️ MONDAY_API_KEY missing");
      return "";
    }

    const id = Number(itemId) || 0;
    if (!id || !columnId) return "";

    const query = `
      query {
        items (ids: ${id}) {
          column_values(ids: ["${columnId}"]) {
            value
            text
          }
        }
      }
    `;

    const response = await axios.post(
      "https://api.monday.com/v2",
      { query },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        timeout: 10000,
      }
    );

    const cv = response?.data?.data?.items?.[0]?.column_values?.[0];
    let phone = "";
    if (cv?.value) {
      try {
        const parsed = JSON.parse(cv.value);
        phone = parsed?.phone || "";
      } catch {}
    }
    if (!phone) phone = cv?.text || "";
    return phone;
  } catch (err) {
    console.error("❌ 전화번호 가져오기 실패:", err?.response?.data || err?.message || err);
    return "";
  }
}

// ✅ 서버 시작
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🚀 서버 실행 중: http://localhost:${PORT}`)
);
