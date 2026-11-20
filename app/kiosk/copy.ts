export const kioskCopy = {
  en: {
    assistedIn: "Report a missed clock-in", assistedOut: "Report a missed clock-out", actualDate: "Actual date", actualTime: "Actual time",
    assistanceReason: "Reason for the correction", submitTime: "Submit actual time", assistancePending: "Time reported. A manager can review it.",
    assistanceApproved: "Corrected clock-out recorded and approved.", clockOutReminder: "Your shift has ended. Clock out or report the time you finished.",
    assistanceUnavailable: "This correction is unavailable for your current shift.", assistanceTime: "Enter a valid recent time that follows your other clock entries.",
    rest: "Paid rest break", meal: "Unpaid meal break", startRest: "Start paid rest break", startMeal: "Start unpaid meal break",
    onRest: "You are on a paid rest break.", onMeal: "You are on an unpaid meal break.", remaining: "Break time remaining",
    offDutyExtension: "I stayed off duty for all of the extra break time.", startedWork: "I already started work", resumedWork: "I already resumed work",
    earlyClock: "It is too early to clock in. If you already started work, tell a manager so your time can be recorded.",
    earlyReturn: "Your break is still in progress.", breaksChanged: "Break requirements changed. Enter your PIN again to review them.", earlyApproval: "Early work needs manager approval.",
    reviewBreaks: "Review your breaks", breakOutcome: "What happened?", choose: "Choose an option", missed: "I missed this break",
    unrecorded: "I took it and forgot to record it", waive: "I voluntarily agree to waive this meal", waiverConsent: "Your workplace also allows this waiver. You can choose to report a missed meal instead.",
    waiverReason: "Reason for the waiver", breakTimes: "When did you start and end this break?", confirmClockOut: "Confirm and clock out", back: "Back",
    clock: "DomBase time clock", tablet: "Breakroom tablet", checking: "Checking this tablet…",
    register: "Register this tablet", registrationHint: "Ask an Owner or authorized manager to register this browser from the dashboard. Employee PINs are available after registration.",
    employeePin: "Employee PIN", managerPin: "Manager approval PIN", employeeHint: "Enter your own 4–8 digit PIN.", managerHint: "Approves this request only. The screen returns to employee PIN entry.",
    keypad: "PIN keypad", clear: "Clear", clearPin: "Clear PIN", delete: "Delete", deleteDigit: "Delete last digit",
    tempLocked: "Temporarily locked", wait: "Please wait…", approve: "Approve request", continue: "Continue",
    managerLocked: "Manager approval on this tablet is temporarily locked.", pinLocked: "PIN entry on this tablet is temporarily locked.", pinAttempts: "Too many attempts with this PIN.",
    retryPin: "Try this PIN again in", retryDevice: "Try again in", managerOther: "Another manager can enter a different approval PIN.", employeeOther: "Other employees can still enter their own PINs.",
    askManager: "Ask a manager for help if you need to record your time.", noAction: "No clock action has been recorded.",
    hello: "Hello", clockedOut: "You are clocked out.", onBreak: "You are on a break.", clockedIn: "You are clocked in.", role: "Job role", noRole: "No active job role",
    assignRole: "Ask a manager to assign you an active job role before clocking in.", note: "Note (optional)", clockIn: "Clock in", clockOut: "Clock out", startBreak: "Start break", endBreak: "End break",
    cancel: "Cancel and lock", lockHint: "This screen locks automatically. Sign in again for your next action.", locked: "Screen locked. Enter your PIN for another action.",
    retry: "Try again", checkingFailed: "Could not check this tablet. Retrying automatically when connected.", connection: "Could not connect. Please try again.",
    approval: "Manager approval", approvalReason: "Clock-in is outside a published shift. A manager must approve it.",
    badPin: "Invalid employee PIN.", badManager: "Invalid manager approval PIN.", managerScope: "This manager cannot approve this clock request.",
    expired: "Enter your employee PIN again.", changed: "Your clock status changed. Enter your PIN again.", chooseRole: "Choose one of your active job roles.",
    offlinePin: "Offline. Reconnect to enter your PIN.", offlineAction: "Offline. Your next clock action can be queued before this screen locks.", offlineApproval: "Reconnect to submit manager approval.",
    queued: "Clock action queued on this tablet. It will sync when the connection returns.", pending: "Clock actions are waiting to sync.", synced: "Queued clock actions synced.", review: "A queued action was sent for manager review.",
    queueHelp: "A queued action could not be uploaded. Ask a manager to check your time.", storage: "Offline storage is unavailable. Keep the tablet connected to record time.",
    in: "Clock-in recorded.", out: "Clock-out recorded.", break: "Break started.", break_end: "Break ended.", recovery: "The clock stopped unexpectedly. Reopening the clock…",
  },
  es: {
    assistedIn: "Reportar entrada olvidada", assistedOut: "Reportar salida olvidada", actualDate: "Fecha real", actualTime: "Hora real",
    assistanceReason: "Motivo de la corrección", submitTime: "Enviar hora real", assistancePending: "Se registró la hora. Un gerente puede revisarla.",
    assistanceApproved: "Salida corregida y aprobada.", clockOutReminder: "Tu turno terminó. Registra tu salida o reporta la hora en que terminaste.",
    assistanceUnavailable: "Esta corrección no está disponible para tu turno actual.", assistanceTime: "Ingresa una hora reciente y válida que siga el orden de tus registros.",
    rest: "Descanso pagado", meal: "Comida no pagada", startRest: "Iniciar descanso pagado", startMeal: "Iniciar comida no pagada",
    onRest: "Estás en un descanso pagado.", onMeal: "Estás en una pausa para comer no pagada.", remaining: "Tiempo restante de descanso",
    offDutyExtension: "Estuve libre de tareas durante todo el tiempo adicional.", startedWork: "Ya empecé a trabajar", resumedWork: "Ya volví a trabajar",
    earlyClock: "Es demasiado temprano para registrar la entrada. Si ya empezaste a trabajar, avisa a un gerente para registrar tu tiempo.",
    earlyReturn: "Tu descanso aún no termina.", breaksChanged: "Los requisitos de descanso cambiaron. Ingresa tu PIN para revisarlos.", earlyApproval: "El trabajo antes del turno requiere aprobación del gerente.",
    reviewBreaks: "Revisa tus descansos", breakOutcome: "¿Qué pasó?", choose: "Elige una opción", missed: "No tomé este descanso",
    unrecorded: "Lo tomé, pero olvidé registrarlo", waive: "Acepto voluntariamente omitir esta comida", waiverConsent: "Tu lugar de trabajo también permite omitir esta comida. Puedes optar por reportarla como omitida sin renuncia.",
    waiverReason: "Motivo de la renuncia", breakTimes: "¿A qué hora empezó y terminó tu descanso?", confirmClockOut: "Confirmar y registrar salida", back: "Volver",
    clock: "Reloj de asistencia DomBase", tablet: "Tableta de la sala de descanso", checking: "Verificando esta tableta…",
    register: "Registra esta tableta", registrationHint: "Pide a un propietario o gerente autorizado que registre este navegador desde el panel de administración. Después podrás ingresar tu PIN.",
    employeePin: "PIN de empleado", managerPin: "PIN de aprobación del gerente", employeeHint: "Ingresa tu propio PIN de 4 a 8 dígitos.", managerHint: "Solo aprueba esta solicitud. La pantalla vuelve al ingreso del PIN de empleado.",
    keypad: "Teclado de PIN", clear: "Borrar", clearPin: "Borrar PIN", delete: "Eliminar", deleteDigit: "Eliminar el último dígito",
    tempLocked: "Bloqueado temporalmente", wait: "Espera un momento…", approve: "Aprobar solicitud", continue: "Continuar",
    managerLocked: "La aprobación del gerente está bloqueada temporalmente en esta tableta.", pinLocked: "El ingreso del PIN está bloqueado temporalmente en esta tableta.", pinAttempts: "Demasiados intentos con este PIN.",
    retryPin: "Vuelve a intentar con este PIN en", retryDevice: "Vuelve a intentarlo en", managerOther: "Otro gerente puede ingresar un PIN de aprobación diferente.", employeeOther: "Los demás empleados pueden ingresar su propio PIN.",
    askManager: "Pide ayuda a un gerente si necesitas registrar tu tiempo.", noAction: "No se ha registrado ninguna acción.",
    hello: "Hola", clockedOut: "Tu salida está registrada.", onBreak: "Estás en un descanso.", clockedIn: "Tu entrada está registrada.", role: "Puesto de trabajo", noRole: "Sin puesto activo",
    assignRole: "Pide a un gerente que te asigne un puesto activo antes de registrar tu entrada.", note: "Nota (opcional)", clockIn: "Registrar entrada", clockOut: "Registrar salida", startBreak: "Iniciar descanso", endBreak: "Terminar descanso",
    cancel: "Cancelar y bloquear", lockHint: "La pantalla se bloquea automáticamente. Ingresa tu PIN para la siguiente acción.", locked: "Pantalla bloqueada. Ingresa tu PIN para otra acción.",
    retry: "Reintentar", checkingFailed: "No se pudo verificar esta tableta. Se volverá a intentar cuando haya conexión.", connection: "No se pudo conectar. Intenta de nuevo.",
    approval: "Aprobación del gerente", approvalReason: "La entrada está fuera de un turno publicado. Un gerente debe aprobarla.",
    badPin: "PIN de empleado incorrecto.", badManager: "PIN de aprobación incorrecto.", managerScope: "Este gerente no puede aprobar esta solicitud.",
    expired: "Vuelve a ingresar tu PIN de empleado.", changed: "Tu estado cambió. Vuelve a ingresar tu PIN.", chooseRole: "Selecciona uno de tus puestos activos.",
    offlinePin: "Sin conexión. Conéctate para ingresar tu PIN.", offlineAction: "Sin conexión. Puedes guardar tu siguiente acción antes de que se bloquee la pantalla.", offlineApproval: "Conéctate para enviar la aprobación del gerente.",
    queued: "Acción guardada en esta tableta. Se enviará cuando vuelva la conexión.", pending: "Hay acciones pendientes de enviar.", synced: "Se enviaron las acciones pendientes.", review: "Se envió una acción pendiente para revisión del gerente.",
    queueHelp: "No se pudo enviar una acción pendiente. Pide a un gerente que revise tu tiempo.", storage: "El almacenamiento sin conexión no está disponible. Mantén la tableta conectada para registrar tu tiempo.",
    in: "Entrada registrada.", out: "Salida registrada.", break: "Descanso iniciado.", break_end: "Descanso terminado.", recovery: "El reloj se cerró inesperadamente. Volviendo a abrir…",
  },
} as const;

export type KioskLanguage = keyof typeof kioskCopy;
export type KioskText = keyof typeof kioskCopy.en;
export const languageKey = "dombase-kiosk-language";
export const localizedError = (message: unknown, status: number, action: string): KioskText => {
  if (message === kioskCopy.en.managerScope) return "managerScope";
  if (message === kioskCopy.en.chooseRole) return "chooseRole";
  if (status === 401 && action === "pin") return "badPin";
  if (message === kioskCopy.en.badManager) return "badManager";
  if (status === 401) return "expired";
  if (message === "It is too early to clock in.") return "earlyClock";
  if (message === kioskCopy.en.earlyReturn) return "earlyReturn";
  if (message === kioskCopy.en.breaksChanged) return "breaksChanged";
  if (typeof message === "string" && (/Assisted clock|automatic clock-out already/.test(message))) return "assistanceUnavailable";
  if (typeof message === "string" && (/actual date|recent time|local date|overlaps another clock/.test(message))) return "assistanceTime";
  if (status === 409) return "changed";
  return "connection";
};
