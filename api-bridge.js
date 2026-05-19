/**
 * api-bridge.js — INTEGRA Payroll
 * Bridges google.script.run calls to GAS Web App via fetch()
 * Also provides local fallback when GAS is unreachable (dev mode)
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbw-hkrmceGmKY27268YCDdwZsDDRVgrjCcYLVKEYA71Uf9z4iNhi4CFU_yhOCfft5sC/exec';

// Actions that use GET (no body), everything else uses POST
const GAS_GET_ACTIONS = new Set([
  'checkLocation',
  'getAdminUserList',
  'getDepartmentList',
  'getSalaryItemTypes',
  'getDeductionTypes',
  'getAttendanceList',
  'getPayrollSummary',
  'getSalaryRecords',
  'getConfigValues',
  'getUserPermissions',
  'getDashboardStats',
  'getEmployeePortalData',
  'getEmployeeSlip'
]);

class GASRunner {
  constructor() {
    this._successCb = null;
    this._failureCb = null;
  }

  withSuccessHandler(fn) {
    this._successCb = fn;
    return this._proxy();
  }

  withFailureHandler(fn) {
    this._failureCb = fn;
    return this._proxy();
  }

  _proxy() {
    const self = this;
    return new Proxy({}, {
      get(_, fnName) {
        return (...args) => self._call(fnName, args);
      }
    });
  }

  async _call(fnName, args) {
    const payload = args[0] !== undefined ? args[0] : {};
    try {
      let response;
      if (GAS_GET_ACTIONS.has(fnName)) {
        const params = new URLSearchParams({ action: fnName, ...payload });
        response = await fetch(`${GAS_API_URL}?${params}`, { method: 'GET' });
      } else {
        response = await fetch(GAS_API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ action: fnName, payload })
        });
      }
      const data = await response.json();
      if (data && data.error) {
        if (this._failureCb) this._failureCb(new Error(data.error));
      } else {
        if (this._successCb) this._successCb(data);
      }
    } catch (err) {
      // Network error or GAS not available → local fallback
      console.warn(`[api-bridge] GAS unreachable for ${fnName}, using local fallback:`, err.message);
      this._localFallback(fnName, args);
    }
  }

  async _localFallback(fnName, args) {
    const payload = args[0] || {};
    const _ok = (data) => { if (this._successCb) this._successCb(data); };
    const _fail = (msg) => { if (this._failureCb) this._failureCb(new Error(msg)); };

    switch (fnName) {
      case 'loginAdmin': {
        try {
          const res = await fetch('local_users.json');
          const users = await res.json();
          const user = users.find(u =>
            u.username === payload.username &&
            u.password_hash === payload.password
          );
          if (user) {
            _ok({ success: true, role: user.role, name: user.name, empId: user.id, username: user.username, permissions: user.permissions || '' });
          } else {
            _ok({ success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
          }
        } catch (e) {
          _fail('ไม่พบไฟล์ local_users.json — กรุณา deploy GAS');
        }
        break;
      }

      case 'getAdminUserList': {
        try {
          const res = await fetch('local_users.json');
          const users = await res.json();
          _ok(users);
        } catch (e) {
          _fail('ไม่พบไฟล์ local_users.json');
        }
        break;
      }

      case 'checkLocation': {
        // Trigger failure → caller shows gps-only or disables GPS requirement
        _fail('GPS ไม่พร้อมในโหมดออฟไลน์');
        break;
      }

      case 'verifyFaceAndSave': {
        _ok({ matched: true, empId: payload.empId || 'EMP001', name: payload.name || 'พนักงานทดสอบ' });
        break;
      }

      case 'saveAttendance': {
        const now = new Date();
        _ok({ success: true, time: now.toTimeString().slice(0, 5), message: 'บันทึกสำเร็จ (โหมดทดสอบ)' });
        break;
      }

      case 'saveFaceRegistration':
      case 'processRegistration': {
        _ok({ success: true, message: 'บันทึกใบหน้าสำเร็จ (โหมดทดสอบ)' });
        break;
      }

      case 'getDashboardStats': {
        _ok({ totalEmployees: 0, presentToday: 0, absentToday: 0, pendingApproval: 0 });
        break;
      }

      case 'getEmployeePortalData': {
        _ok({ name: window._currentUser?.name || 'พนักงาน', empId: window._currentUser?.empId || '', slipMonth: '-', leaveBalance: 0 });
        break;
      }

      default: {
        _fail(`[offline] ฟังก์ชัน "${fnName}" ต้องการ GAS Web App — กรุณา deploy และตรวจสอบ URL`);
        break;
      }
    }
  }
}

// ── ทำให้ runner รองรับ chain: .withSuccessHandler().withFailureHandler().fnName()
function _makeChainable(runner) {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'withSuccessHandler') {
        return (fn) => { runner._successCb = fn; return _makeChainable(runner); };
      }
      if (prop === 'withFailureHandler') {
        return (fn) => { runner._failureCb = fn; return _makeChainable(runner); };
      }
      // ถึงตรงนี้ = ชื่อฟังก์ชัน GAS จริง
      return (...args) => runner._call(prop, args);
    }
  });
}

// Override window.google.script.run
(function () {
  const gasObj = {
    script: {
      get run() {
        // ทุกครั้งที่เข้าถึง .run จะได้ proxy ใหม่
        return new Proxy({}, {
          get(_, prop) {
            const runner = new GASRunner();
            if (prop === 'withSuccessHandler') {
              return (fn) => { runner._successCb = fn; return _makeChainable(runner); };
            }
            if (prop === 'withFailureHandler') {
              return (fn) => { runner._failureCb = fn; return _makeChainable(runner); };
            }
            // เรียกตรงๆ ไม่มี handler
            return (...args) => runner._call(prop, args);
          }
        });
      }
    }
  };

  Object.defineProperty(window, 'google', {
    value: gasObj,
    writable: false,
    configurable: true
  });

  console.log('[api-bridge] ✅ loaded. GAS URL:', GAS_API_URL);
})();
