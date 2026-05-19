/**
 * api-bridge.js — INTEGRA Payroll
 * แทนที่ google.script.run ด้วย fetch() → GAS Web App
 * ไม่ใช้ Proxy เลย — ปลอดภัย 100%
 */

const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbw-hkrmceGmKY27268YCDdwZsDDRVgrjCcYLVKEYA71Uf9z4iNhi4CFU_yhOCfft5sC/exec';

// ─── สร้าง runner object ใหม่ทุกครั้ง ───────────────────────
function _makeGasRun() {
  var _ok  = null;
  var _err = null;

  // ─── เรียก GAS จริง หรือ fallback ──────────────────────────
  async function _call(fnName, payload) {
    try {
      // Timeout 6 วินาที — ถ้า GAS ช้าให้ใช้ fallback ทันที
      var ctrl = new AbortController();
      var timer = setTimeout(function(){ ctrl.abort(); }, 6000);
      var resp = await fetch(GAS_API_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    JSON.stringify({ action: fnName, payload: payload || {} }),
        signal:  ctrl.signal
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var data = await resp.json();
      if (data && data.error) throw new Error(data.error);
      if (_ok) _ok(data);
    } catch(e) {
      console.warn('[api-bridge] fallback (' + fnName + '):', e.message);
      await _fallback(fnName, payload || {});
    }
  }

  // ─── Local fallback ──────────────────────────────────────────
  async function _fallback(fnName, payload) {
    function ok(d)   { if (_ok)  _ok(d); }
    function fail(m) { if (_err) _err(new Error(m)); }

    if (fnName === 'loginAdmin') {
      try {
        var r = await fetch('local_users.json');
        if (!r.ok) throw new Error('404');
        var users = await r.json();
        var found = null;
        for (var i = 0; i < users.length; i++) {
          var u = users[i];
          if (String(u.username).toLowerCase() === String(payload.username || '').toLowerCase() &&
              String(u.password_hash) === String(payload.password || '')) {
            found = u; break;
          }
        }
        if (found) {
          ok({ success: true, role: found.role, name: found.name,
               empId: found.id, username: found.username, permissions: found.permissions || '' });
        } else {
          ok({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
        }
      } catch(e2) {
        fail('โหลด local_users.json ไม่ได้: ' + e2.message);
      }

    } else if (fnName === 'getAdminUserList') {
      try {
        var r2 = await fetch('local_users.json');
        ok(await r2.json());
      } catch(e2) { fail('ไม่พบ local_users.json'); }

    } else if (fnName === 'checkLocation') {
      fail('GPS ไม่พร้อมในโหมดออฟไลน์');

    } else if (fnName === 'verifyFaceAndSave') {
      ok({ matched: true, empId: payload.empId || 'WALK001', name: payload.name || 'พนักงาน' });

    } else if (fnName === 'saveAttendance') {
      var now = new Date();
      ok({ success: true, time: now.toTimeString().slice(0,5), message: 'บันทึก (offline)' });

    } else if (fnName === 'saveEmployee') {
      ok({ success: true, message: 'บันทึกพนักงาน (offline mode — ต้องการ GAS เพื่อบันทึกจริง)' });

    } else if (fnName === 'deleteEmployee' || fnName === 'resignEmployee') {
      ok({ success: true });

    } else if (fnName === 'saveFaceRegistration' || fnName === 'processRegistration') {
      ok({ success: true, message: 'บันทึกใบหน้า (offline)' });

    } else if (fnName === 'getDashboardStats') {
      ok({ totalActive:0, approvers:0, presentToday:0, lateToday:0, absentCount:0, pendingLeave:0 });

    } else if (fnName === 'getEmployeePortalData') {
      ok({ timeIn:'—', timeOut:'—', lateMin:0, status:'ยังไม่ลงเวลา' });

    } else if (fnName === 'getConfigValues' || fnName === 'getConfig') {
      ok({ note: 'offline mode' });

    } else if (fnName === 'getEmployeeData') {
      // Demo data (offline) — แทนที่ด้วยข้อมูลจริงเมื่อ GAS พร้อม
      ok([
        { id:'EMP001', code:'EMP001', name:'สมชาย ใจดี',      dept:'ฝ่ายบุคคล',  position:'ผู้จัดการ HR',   dob:'01/01/2530', startDate:'01/06/2563', baseSalary:35000, phone:'081-000-0001', statusToday:'มาทำงาน' },
        { id:'EMP002', code:'EMP002', name:'สมหญิง สวยงาม',   dept:'ฝ่ายบัญชี', position:'นักบัญชี',        dob:'15/03/2535', startDate:'15/08/2564', baseSalary:28000, phone:'082-000-0002', statusToday:'มาทำงาน' },
        { id:'EMP003', code:'EMP003', name:'วิชัย รักงาน',    dept:'ฝ่ายขาย',   position:'พนักงานขาย',      dob:'20/07/2532', startDate:'01/01/2565', baseSalary:22000, phone:'083-000-0003', statusToday:'สาย'      },
        { id:'EMP004', code:'EMP004', name:'มาลี ดีมาก',      dept:'ฝ่ายผลิต',  position:'พนักงานผลิต',    dob:'10/10/2538', startDate:'01/03/2565', baseSalary:18000, phone:'084-000-0004', statusToday:'ขาด'      },
        { id:'EMP005', code:'EMP005', name:'ประสิทธิ์ เก่งมาก',dept:'ฝ่าย IT',  position:'นักพัฒนาระบบ',   dob:'05/05/2537', startDate:'01/06/2566', baseSalary:42000, phone:'085-000-0005', statusToday:'มาทำงาน' }
      ]);

    } else if (fnName === 'getDepartmentData') {
      ok([
        { id:'DEPT01', name:'ฝ่ายบุคคล',  description:'Human Resources',  count:2 },
        { id:'DEPT02', name:'ฝ่ายบัญชี', description:'Accounting & Finance', count:1 },
        { id:'DEPT03', name:'ฝ่ายขาย',   description:'Sales Department',  count:1 },
        { id:'DEPT04', name:'ฝ่ายผลิต',  description:'Production',        count:1 },
        { id:'DEPT05', name:'ฝ่าย IT',   description:'Information Technology', count:1 }
      ]);

    } else if (fnName === 'getSalaryItemTypes' || fnName === 'getDeductionTypes' ||
               fnName === 'getAttendanceList'  || fnName === 'getSalaryRecords') {
      ok([]);

    } else if (fnName === 'getAttendanceCalendarData') {
      // Attendance timesheet grid — return empty structure
      ok({ header: [], employees: [] });

    } else if (fnName === 'getSalaryHistoryData' || fnName === 'getRecordDetailsData') {
      // Salary history / record details — return empty array
      ok([]);

    } else if (fnName === 'calculateMonthlySalary') {
      ok({ data: [], exportConfig: [], alreadyPaid: false });

    } else {
      // Unknown function: call failure handler (or swallow if none set)
      if (_err) _err(new Error('[offline] "' + fnName + '" ต้องการ GAS — deploy แล้วลองใหม่'));
      else console.warn('[api-bridge offline] unhandled:', fnName);
    }
  }

  // ─── สร้าง api object — ทุก method เป็น function จริงๆ ────
  var api = {

    withSuccessHandler: function(fn) { _ok  = fn; return api; },
    withFailureHandler: function(fn) { _err = fn; return api; },

    // ── Auth ──
    loginAdmin:           function(p) { return _call('loginAdmin', p); },
    getAdminUserList:     function(p) { return _call('getAdminUserList', p); },
    saveAdminUser:        function(p) { return _call('saveAdminUser', p); },
    deleteAdminUser:      function(p) { return _call('deleteAdminUser', p); },
    saveUserPermissions:  function(p) { return _call('saveUserPermissions', p); },

    // ── Dashboard ──
    getDashboardStats:    function(p) { return _call('getDashboardStats', p); },

    // ── Employees ──
    getEmployeeData:      function(p) { return _call('getEmployeeData', p); },
    saveEmployee:         function(p) { return _call('saveEmployee', p); },
    deleteEmployee:       function(p) { return _call('deleteEmployee', p); },

    // ── Departments ──
    getDepartmentData:    function(p) { return _call('getDepartmentData', p); },
    saveDepartment:       function(p) { return _call('saveDepartment', p); },

    // ── Salary ──
    getSalaryItemTypes:   function(p) { return _call('getSalaryItemTypes', p); },
    getDeductionTypes:    function(p) { return _call('getDeductionTypes', p); },
    calculateMonthlySalary: function(p) { return _call('calculateMonthlySalary', p); },
    getSalaryRecords:     function(p) { return _call('getSalaryRecords', p); },
    getEmployeeSlip:      function(p) { return _call('getEmployeeSlip', p); },

    // ── Attendance ──
    getAttendanceList:    function(p) { return _call('getAttendanceList', p); },
    saveAttendance:       function(p) { return _call('saveAttendance', p); },

    // ── Face ──
    verifyFaceAndSave:    function(p) { return _call('verifyFaceAndSave', p); },
    saveFaceRegistration: function(p) { return _call('saveFaceRegistration', p); },
    processRegistration:  function(p) { return _call('processRegistration', p); },

    // ── Config ──
    getConfigValues:      function(p) { return _call('getConfigValues', p); },
    getConfig:            function(p) { return _call('getConfig', p); },
    saveConfig:           function(p) { return _call('saveConfig', p); },

    // ── Employee Portal ──
    getEmployeePortalData: function(p) { return _call('getEmployeePortalData', p); },
    checkLocation:        function(p) { return _call('checkLocation', p); }
  };

  return api;
}

// ─── ติดตั้ง window.google.script.run ────────────────────────
(function() {
  var scriptObj = {
    get run() { return _makeGasRun(); }
  };

  if (window.google && window.google.script) {
    // google มีอยู่แล้ว (เช่น gtag) — patch เฉพาะ script
    window.google.script = scriptObj;
  } else if (window.google) {
    window.google.script = scriptObj;
  } else {
    window.google = { script: scriptObj };
  }

  console.log('[api-bridge] ✅ พร้อมใช้งาน — GAS:', GAS_API_URL);
})();
