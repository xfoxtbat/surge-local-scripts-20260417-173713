/**
 * emos.best 每日签到脚本
 *
 * 逻辑：
 * 1. 读取 Surge persistentStore 里的 emos_token
 * 2. 请求 /api/user
 * 3. 用 user.sign.sign_at 判断“今天是否已签到”
 * 4. 未签到才调用 /api/user/sign
 *
 * 注意：不再使用 /api/sign/check 作为判断依据。
 */

const STORE_KEY = "emos_token";
const STORE_COOKIE_KEY = "emos_cookie";
const TITLE = "emos 签到";
const BASE_URL = "https://emos.best";

const SIGN_CONTENTS = [
  "今日签到",
  "来啦",
  "打卡",
  "签到中",
  "继续",
  "冲呀",
  "已到",
  "报到",
  "加油",
  "摸鱼签"
];

function notify(sub, body) {
  $notification.post(TITLE, sub, body);
}

function isToday(dateStr) {
  if (!dateStr) return false;
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  return String(dateStr).slice(0, 10) === todayStr;
}

// http-response 模式：自动从请求头抓 token 并保存
if (typeof $request !== "undefined") {
  let token = null;
  let cookie = "";

  if ($request && $request.headers) {
    const auth =
      $request.headers["Authorization"] ||
      $request.headers["authorization"] || "";
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) token = match[1].trim();

    cookie =
      $request.headers["Cookie"] ||
      $request.headers["cookie"] || "";
  }

  if (!token) {
    try {
      const body = JSON.parse(($response && $response.body) || "{}");
      token =
        body.token ||
        body.user_token ||
        body.access_token ||
        body.accessToken ||
        (body.data && (body.data.token || body.data.user_token || body.data.access_token || body.data.accessToken)) ||
        null;
    } catch (e) {}
  }

  if (token) {
    const old = $persistentStore.read(STORE_KEY);
    if (old !== token) {
      $persistentStore.write(token, STORE_KEY);
      console.log(`[${TITLE}] token 已更新`);
    }
  }

  if (cookie) {
    const oldCookie = $persistentStore.read(STORE_COOKIE_KEY) || "";
    if (oldCookie !== cookie) {
      $persistentStore.write(cookie, STORE_COOKIE_KEY);
      console.log(`[${TITLE}] cookie 已更新`);
    }
  }

  if (!token && !cookie) {
    console.log(`[${TITLE}] 未从响应中抓到 token/cookie`);
  }

  $done({});
}

// cron 模式：每日签到
else {
  const TOKEN = $persistentStore.read(STORE_KEY) || "";
  const COOKIE = $persistentStore.read(STORE_COOKIE_KEY) || "";

  if (!TOKEN && !COOKIE) {
    notify("❌ 未获取到凭证", "请先打开 emos.best 并登录，让 Surge 自动抓取 token 或 cookie");
    $done({});
  } else {
    const headers = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 emos-surge/1.0"
    };
    if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
    if (COOKIE) headers.Cookie = COOKIE;

    console.log(`[${TITLE}] 开始签到流程 | hasToken=${TOKEN ? 'Y' : 'N'} hasCookie=${COOKIE ? 'Y' : 'N'}`);

    // Step 1: 查 user，按 sign.sign_at 判断今天是否已签
    $httpClient.get(
      { url: `${BASE_URL}/api/user`, headers },
      (err, resp, body) => {
        if (err) {
          notify("❌ 网络错误", `获取用户信息失败: ${err}`);
          $done({});
          return;
        }

        if (!resp) {
          notify("❌ 网络错误", "未收到服务器响应");
          $done({});
          return;
        }

        console.log(`[${TITLE}] /api/user HTTP ${resp.status} | ${(body || '').slice(0, 200)}`);

        if (resp.status === 401) {
          $persistentStore.write("", STORE_KEY);
          $persistentStore.write("", STORE_COOKIE_KEY);
          notify("❌ 凭证已失效", "请重新打开 emos.best（保持 Surge 开启）以自动刷新凭证");
          $done({});
          return;
        }

        let userData = {};
        try {
          userData = JSON.parse(body);
        } catch (e) {
          notify("❌ 响应解析失败", String(e));
          $done({});
          return;
        }

        const signInfo = userData.sign || (userData.data && userData.data.sign) || null;
        const signAt = signInfo && signInfo.sign_at ? signInfo.sign_at : null;

        if (isToday(signAt)) {
          notify(
            "✅ 今日已签到",
            `时间: ${signAt} | 连续 ${signInfo.continuous_days || "?"} 天 | 获得 ${signInfo.earn_point || "?"} 萝卜`
          );
          $done({});
          return;
        }

        // Step 2: 未签到，执行签到
        const content = SIGN_CONTENTS[Math.floor(Math.random() * SIGN_CONTENTS.length)];

        $httpClient.put(
          {
            url: `${BASE_URL}/api/user/sign?content=${encodeURIComponent(content)}`,
            headers
          },
          (signErr, signResp, signBody) => {
            if (signErr) {
              notify("❌ 签到请求失败", String(signErr));
              $done({});
              return;
            }

            if (!signResp) {
              notify("❌ 签到失败", "未收到签到响应");
              $done({});
              return;
            }

            console.log(`[${TITLE}] /api/user/sign HTTP ${signResp.status} | ${(signBody || '').slice(0, 200)}`);

            let data = {};
            try {
              data = JSON.parse(signBody);
            } catch (e) {}

            if (signResp.status === 200 && (data.earn_point !== undefined || data.success === true || data.code === 200 || data.code === 0)) {
              notify(
                `✅ 签到成功！获得 🥕 ${data.earn_point !== undefined ? data.earn_point : '?'} 萝卜`,
                `连续签到 ${data.continuous_days || '?'} 天 | 累计第 ${data.sign_index || '?'} 次\n「${content}」`
              );
            } else if (signResp.status === 401) {
              $persistentStore.write("", STORE_KEY);
              $persistentStore.write("", STORE_COOKIE_KEY);
              notify("❌ 凭证已失效", "请重新打开 emos.best 自动更新凭证");
            } else if (signResp.status === 429) {
              notify("⚠️ 请求过频", "请勿重复触发，每日仅限一次");
            } else if ((signBody || '').includes('已签到')) {
              notify("✅ 今日已签到", (signBody || '').slice(0, 120));
            } else {
              notify(`⚠️ 异常 (HTTP ${signResp.status})`, (signBody || "").slice(0, 200));
            }

            $done({});
          }
        );
      }
    );
  }
}
