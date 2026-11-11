// ══════════════════════════════════════════════════════════════════════════════
// Netlify Serverless API: الترخيص المركزي وتحديثات السكرتير الموحد
// ══════════════════════════════════════════════════════════════════════════════

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "UnifiedSecretaryByIbrahimAldababsa1998";

// ذاكرة تخزين مؤقتة وسريعة
let state = {
  schools: {},
  update: {
    latestVersion: "1.0.5",
    downloadUrl: "",
    changelog: "إصدار رسمي ومستقر مع دعم التحديث التلقائي وجدول التوزيع والمواقيت الحية.",
    isMandatory: false,
    updatedAt: new Date().toISOString()
  }
};

// محاولة استخدام Netlify Blobs للحفظ الدائم إن وُجد
async function getBlobStore() {
  try {
    const { getStore } = require("@netlify/blobs");
    return getStore("license-data");
  } catch (e) {
    return null;
  }
}

async function loadPersistedState() {
  try {
    const store = await getBlobStore();
    if (store) {
      const data = await store.get("portal-state", { type: "json" });
      if (data) {
        state = data;
      }
    }
  } catch (e) {
    console.warn("Blobs load warning:", e.message);
  }
}

async function savePersistedState() {
  try {
    const store = await getBlobStore();
    if (store) {
      await store.setJSON("portal-state", state);
    }
  } catch (e) {
    console.warn("Blobs save warning:", e.message);
  }
}

// دالة الرد الموحدة
function reply(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      ...headers
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  };
}

exports.handler = async (event, context) => {
  // 1. معالجة طلبات CORS Preflight
  if (event.httpMethod === "OPTIONS") {
    return reply(204, "");
  }

  await loadPersistedState();

  const fullPath = event.path || "";
  const subPath = fullPath.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/api/, "") || "/";
  const method = event.httpMethod;

  let body = {};
  if (event.body) {
    try {
      body = JSON.parse(event.body);
    } catch (e) {}
  }

  // ─── 1. نبضة الحضور والمزامنة التلقائية للتطبيق ───
  // POST /api/heartbeat أو POST /api/register
  if (method === "POST" && (subPath === "/heartbeat" || subPath === "/register")) {
    const mid = (body.machineId || "").trim();
    if (!mid) {
      return reply(400, { success: false, error: "معرّف الجهاز مطلوب." });
    }

    const nowIso = new Date().toISOString();
    let school = state.schools[mid];

    if (!school) {
      // مدرسة جديدة تُسجل لأول مرة تلقائياً بعد التثبيت
      school = {
        machineId: mid,
        schoolName: (body.schoolName || "مدرسة جديدة").trim(),
        principalName: (body.principalName || "").trim(),
        directorate: (body.directorate || "").trim(),
        appVersion: body.appVersion || "1.0.5",
        registeredAt: nowIso,
        lastSeenAt: nowIso,
        remainingDays: body.remainingDays !== undefined ? body.remainingDays : 45,
        remainingSeconds: body.remainingSeconds || 0,
        graceSeconds: body.graceSeconds || 0,
        isRevoked: false,
        ip: event.headers["client-ip"] || event.headers["x-forwarded-for"] || "unknown",
        notes: "تم التسجيل تلقائياً عند التثبيت والاتصال بالإنترنت."
      };
    } else {
      // تحديث بيانات المدرسة المسجلة
      school.lastSeenAt = nowIso;
      if (body.schoolName) school.schoolName = body.schoolName.trim();
      if (body.principalName) school.principalName = body.principalName.trim();
      if (body.directorate) school.directorate = body.directorate.trim();
      if (body.appVersion) school.appVersion = body.appVersion;
      if (body.remainingDays !== undefined) school.remainingDays = body.remainingDays;
      if (body.remainingSeconds !== undefined) school.remainingSeconds = body.remainingSeconds;
      school.ip = event.headers["client-ip"] || event.headers["x-forwarded-for"] || school.ip;
    }

    state.schools[mid] = school;
    await savePersistedState();

    return reply(200, {
      success: true,
      license: {
        status: school.isRevoked ? "revoked" : (school.remainingDays > 0 ? "valid" : "expired"),
        isRevoked: !!school.isRevoked,
        remainingDays: school.remainingDays,
        newGraceSeconds: school.customGraceSeconds || null,
        message: school.isRevoked ? "الترخيص محظور من الإدارة المركزية." : "الترخيص سارٍ بنجاح."
      },
      update: state.update
    });
  }

  // ─── 2. فحص التحديثات المباشر ───
  // GET /api/update-check
  if (method === "GET" && subPath === "/update-check") {
    return reply(200, {
      success: true,
      update: state.update
    });
  }

  // ─── 3. تسجيل دخول المسؤول (Admin Login) ───
  // POST /api/admin/login
  if (method === "POST" && subPath === "/admin/login") {
    const pwd = (body.password || "").trim();
    if (pwd === ADMIN_PASSWORD) {
      return reply(200, { success: true, token: "admin-session-ok" });
    }
    return reply(401, { success: false, error: "كلمة سر المسؤول غير صحيحة." });
  }

  // ─── التحقق من صلاحيات المسؤول للمسارات التالية ───
  const authHeader = event.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const pwdParam = body.password || "";
  const isAdmin = (token === "admin-session-ok" || pwdParam === ADMIN_PASSWORD);

  if (subPath.startsWith("/admin/")) {
    if (!isAdmin) {
      return reply(401, { success: false, error: "غير مصرح - يرجى تسجيل الدخول كمسؤول." });
    }

    // ─── 4. جلب قائمة المدارس والتراخيص ───
    // GET /api/admin/schools
    if (method === "GET" && subPath === "/admin/schools") {
      const list = Object.values(state.schools);
      return reply(200, {
        success: true,
        schools: list,
        update: state.update,
        stats: {
          total: list.length,
          active: list.filter(s => !s.isRevoked && s.remainingDays > 0).length,
          revoked: list.filter(s => s.isRevoked).length,
          expired: list.filter(s => !s.isRevoked && s.remainingDays <= 0).length
        }
      });
    }

    // ─── 5. تعديل ترخيص مدرسة (تمديد، حظر، فك حظر، حذف) ───
    // POST /api/admin/schools/action
    if (method === "POST" && subPath === "/admin/schools/action") {
      const { machineId, action, days, newName, notes } = body;
      const school = state.schools[machineId];
      if (!school) {
        return reply(404, { success: false, error: "لم يتم العثور على المدرسة المحددة." });
      }

      if (action === "revoke") {
        school.isRevoked = true;
      } else if (action === "unban") {
        school.isRevoked = false;
      } else if (action === "add_days") {
        const add = parseInt(days, 10) || 30;
        school.remainingDays = Math.max(0, school.remainingDays + add);
        school.customGraceSeconds = school.remainingDays * 86400;
        school.isRevoked = false;
      } else if (action === "set_days") {
        const setVal = parseInt(days, 10) || 0;
        school.remainingDays = Math.max(0, setVal);
        school.customGraceSeconds = school.remainingDays * 86400;
        school.isRevoked = false;
      } else if (action === "delete") {
        delete state.schools[machineId];
        await savePersistedState();
        return reply(200, { success: true, message: "تم حذف سجل المدرسة بنجاح." });
      }

      if (newName) school.schoolName = newName.trim();
      if (notes !== undefined) school.notes = notes;

      await savePersistedState();
      return reply(200, { success: true, school });
    }

    // ─── 6. نشر إصدار تحديث جديد ───
    // POST /api/admin/release
    if (method === "POST" && subPath === "/admin/release") {
      const { latestVersion, downloadUrl, changelog, isMandatory } = body;
      if (!latestVersion) {
        return reply(400, { success: false, error: "رقم الإصدار مطلوب." });
      }

      state.update = {
        latestVersion: latestVersion.trim(),
        downloadUrl: (downloadUrl || "").trim(),
        changelog: (changelog || "").trim(),
        isMandatory: !!isMandatory,
        updatedAt: new Date().toISOString()
      };

      await savePersistedState();
      return reply(200, { success: true, update: state.update });
    }
  }

  return reply(404, { success: false, error: "المسار غير متوفر." });
};
