export const kioskCopy = {
  en: {
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
  if (status === 409) return "changed";
  return "connection";
};
