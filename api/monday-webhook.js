import axios from "axios";
export default async function handler(req, res) {
  try {
    console.log("📥 Monday 요청 수신:", req.method, req.headers);

    // 1️⃣ Monday가 Challenge를 보낼 때
    if (req.method === "POST") {
      let body = "";

      // 수동으로 body 수집 (Content-Type 문제 대비)
      await new Promise((resolve) => {
        req.on("data", (chunk) => (body += chunk));
        req.on("end", resolve);
      });

      console.log("📦 원본 body:", body);

      // body가 비어있으면 JSON 파싱 시도
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        console.warn("⚠️ body 파싱 실패");
      }

      // ✅ Challenge 응답 처리 (monday는 JSON 본문에 { challenge }를 기대)
      if (parsed.challenge) {
        console.log("✅ Challenge 감지됨:", parsed.challenge);
        res.setHeader("Content-Type", "application/json");
        return res.status(200).json({ challenge: parsed.challenge });
      }

      console.log("📩 일반 이벤트 수신:", parsed);
      res.status(200).json({ ok: true });

      try {
        const event = parsed?.event;
        const status = event?.value?.label?.text;
        const phone = event?.pulseName;

        if (status === "작업 완료" || status === "수리 완료") {
          const payload = {
            status,
            phone,
            boardId: event?.boardId,
            itemId: event?.pulseId,
            columnId: event?.columnId,
            at: new Date().toISOString(),
          };

          setTimeout(async () => {
            try {
              await sendToGoogleSheets(payload);
            } catch (e) {
              console.error("sheets error:", e?.response?.data || e?.message || e);
            }

            try {
              const to = phone || process.env.TEST_SMS_TO;
              if (to) {
                await sendAligoSMS(to, "수리가 완료되었습니다.");
              } else {
                console.log("skip sms: no phone");
              }
            } catch (e) {
              console.error("sms error:", e?.response?.data || e?.message || e);
            }
          }, 0);
        }
      } catch (e) {
        console.error("post-process error:", e);
      }

      return;
    }

    // 2️⃣ GET 요청 (테스트용)
    return res.status(200).send("✅ Monday Webhook Alive");
  } catch (err) {
    console.error("❌ 오류 발생:", err);
    return res.status(500).json({ error: "서버 오류" });
  }
}

async function sendToGoogleSheets(data) {
  const url = process.env.SHEET_API_URL;
  if (!url) return;
  await axios.post(url, data, { timeout: 10000 });
}

async function sendAligoSMS(to, message) {
  const key = process.env.ALIGO_KEY;
  const userId = process.env.ALIGO_USER_ID;
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
  params.append("testmode_yn", test);

  await axios.post(apiUrl, params, {
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    timeout: 10000,
  });
}
