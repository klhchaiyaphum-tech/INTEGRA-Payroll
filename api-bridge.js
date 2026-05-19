/**
 * api-bridge.js — INTEGRA Payroll
 * แทนที่ google.script.run ด้วย fetch() ไปยัง GAS Web App
 * มี local fallback จาก local_users.json เมื่อออฟไลน์
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbw-hkrmceGmKY27268YCDdwZsDDRVgrjCcYLVKEYA71Uf9z4iNhi4CFU_yhOCfft5sC/exec';

// ─────────────────────────────────────────────────────────────
// GASRunner — จัดการ call GAS หรือ fallback ไป local
// ─────────────────────────────────────────────────────────────
class GASRunner {
  constructor() {
    this._ok  = null;  // success callback
    this._err = null;  // failure callback
  }

  withSuccessHandler(fn) {
    this._ok = fn;
    return this._chain();
  }

  withFailureHandler(fn) {
    this._err = fn;
    return this._chain();
  }

  // คืน object ที่ยังต่อ chain ได้ และมีทุก GAS function เป็น method
  _chain() {
    const self = this;
    const handler = {
      withSuccessHandler(fn) { self._ok  = fn; return self._chain(); },
      withFailureHandler(fn) { self._err = fn; return self._chain(); }
    };
    // Proxy: prop ที่ไม่ใช่ withSuccessHandler/withFailureHandler = ชื่อฟังก์ชัน GAS
    return new Proxy(handler, {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop !== 'string') return undefined;
        // ส่งคืน function ที่เรียก GAS
        return function(...args) {
          return self._call(prop, args);
        };
      }
    });
  }

  async _call(fnName, args) {
    const payload = (args && args[0] !== undefined) ? args[0] : {};
    try {
      const resp = await fetch(GAS_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    JSON.stringify({ action: fnName, payload })
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();
      if (data && data.error) throw new Error(data.error);
      if (this._ok) this._ok(data);
    } catch (e) {
      console.warn('[api-bridge] GAS ไม่ตอบสนอง → local fallback (' + fnName + '):', e.message);
      await this._fallback(fnName, payload);
    }
  }

  async _fallback(fnName, payload) {
    const ok   = (d) => { if (this._ok)  this._ok(d); };
    const fail = (m) => { if (this._err) this._err(new Error(m)); };

    switch (fnName) {

      case 'loginAdmin': {
        try {
          const r = await fetch('local_users.json');
          if (!r.ok) throw new Error('ไม่พบไฟล์');
          const users = await r.json();
          const u = users.find(x =>
            String(x.username).toLowerCase() === String(payload.username || '').toLowerCase() &&
            String(x.password_hash) === String(payload.password || '')
          );
          if (u) {
            ok({ success: true, role: u.role, name: u.name,
                 empId: u.id, username: u.username, permissions: u.permissions || '' });
          } else {
            ok({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
          }
        } catch(e) {
          fail('ไม่สามารถโหลด local_users.json: ' + e.message);
        }
        break;
      }

      case 'getAdminUserList': {
        try {
          const r = await fetch('local_users.json');
          ok(await r.json());
        } catch(e) { fail('ไม่พบ local_users.json'); }
        break;
      }

      case 'checkLocation':
        fail('GPS ไม่พร้อมในโหมดออฟไลน์');
        break;

      case 'verifyFaceAndSave':
        ok({ matched: true,
             empId: (payload.empId) || 'WALK001',
             name:  (payload.name)  || 'พนักงานทดสอบ' });
        break;

      case 'saveAttendance': {
        const now = new Date();
        ok({ success: true,
             time: now.toTimeString().slice(0,5),
             message: 'บันทึกสำเร็จ (offline mode)' });
        break;
      }

      case 'saveFaceRegistration':
      case 'processRegistration':
        ok({ success: true, message: 'บันทึกใบหน้า (offline mode)' });
        break;

      case 'getDashboardStats':
        ok({ totalActive:0, approvers:0, presentToday:0,
             lateToday:0, absentCount:0, pendingLeave:0 });
        break;

      case 'getEmployeePortalData':
        ok({ timeIn:'—', timeOut:'—', lateMin:0, status:'ยังไม่ลงเวลา' });
        break;

      case 'getConfigValues':
        ok({ note: 'offline mode — กรุณา deploy GAS' });
        break;

      default:
        fail('[offline] "' + fnName + '" ต้องการ GAS Web App — กรุณา deploy และตรวจสอบ URL');
    }
  }
}

// ─────────────────────────────────────────────────────────────
// ติดตั้ง window.google.script.run
// ─────────────────────────────────────────────────────────────
(function installBridge() {
  // สร้าง run proxy ใหม่ทุกครั้งที่เข้าถึง
  function makeRun() {
    const r = new GASRunner();
    return r._chain();
  }

  const googleObj = {
    script: {
      get run() { return makeRun(); }
    }
  };

  // ถ้า google มีอยู่แล้ว (gtag etc.) ให้ patch เฉพาะ script
  if (window.google) {
    window.google.script = googleObj.script;
  } else {
    try {
      Object.defineProperty(window, 'google', {
        get() { return googleObj; },
        configurable: true
      });
    } catch(e) {
      window.google = googleObj;
    }
  }

  console.log('[api-bridge] ✅ google.script.run พร้อมใช้งาน | GAS:', GAS_API_URL);
})();
