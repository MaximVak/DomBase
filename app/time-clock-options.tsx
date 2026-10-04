type TimeClockOptionsProps = {
  roundingMinutes: 5 | 10 | 15;
  onLaunch: () => void;
};

const unavailable = "Not available yet";

function PlaceholderCheckbox({ label, checked = false }: { label: string; checked?: boolean }) {
  return (
    <label className="enforcement-rule-line time-clock-placeholder" title={unavailable}>
      <input type="checkbox" checked={checked} disabled />
      <span>{label}</span>
    </label>
  );
}

function ClockIllustration({ kind }: { kind: "mobile" | "tablet" | "web" }) {
  const keypad = (
    <g fill="#60738c" fontSize="7" textAnchor="middle">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((number, index) => <text key={number} x={132 + index % 3 * 18} y={91 + Math.floor(index / 3) * 12}>{number}</text>)}
    </g>
  );
  return (
    <svg className={`time-clock-illustration ${kind}`} viewBox="0 0 300 200" aria-hidden="true">
      <rect width="300" height="200" fill={kind === "mobile" ? "#d9e5fa" : kind === "tablet" ? "#b9ead7" : "#b5e3ec"} />
      {kind === "mobile" ? <>
        <path d="m121 200 15-49 12-20 2-30q4-8 9-2l2 25 12-10q8-7 10 2l-9 42-17 42Z" fill="#dfb38f" />
        <rect x="133" y="46" width="45" height="88" rx="4" fill="#f8fafc" />
        <rect x="139" y="59" width="33" height="59" fill="#e8f1fa" />
        <path d="m141 72 28 16m-28 20 30-38m-24-8 18 55" stroke="#ffffff" strokeWidth="5" />
        <path d="m141 72 28 16m-28 20 30-38" stroke="#e6bc5a" strokeWidth="2" />
        <circle cx="156" cy="87" r="6" fill="#2468a9" /><circle cx="156" cy="87" r="2" fill="white" />
        <rect x="145" y="124" width="19" height="3" rx="1" fill="#b4c4d6" />
        <path d="m119 200 7-22 38 12-3 10Z" fill="#195b83" />
      </> : kind === "tablet" ? <>
        <rect x="84" y="42" width="136" height="100" rx="5" fill="#f1f5f9" />
        <rect x="92" y="50" width="118" height="83" fill="#2468a9" />
        <rect x="125" y="59" width="51" height="10" rx="2" fill="#82b0d8" />
        <rect x="122" y="76" width="57" height="48" rx="2" fill="white" />
        {keypad}
        <circle cx="215" cy="92" r="3" fill="#b8c8d8" />
        <path d="m147 200-2-34-11-24q-5-11 3-13l12 9-1-39q0-8 7-6l3 35 16-4q12-1 12 11l-4 25-10 16 2 24Z" fill="#e4b995" />
      </> : <>
        <rect x="86" y="49" width="130" height="88" rx="3" fill="#526579" />
        <rect x="92" y="56" width="118" height="71" fill="#153c60" />
        <rect x="92" y="56" width="118" height="10" fill="#2468a9" />
        <rect x="123" y="71" width="56" height="49" rx="2" fill="white" />
        {keypad}
        <path d="M150 137v14m-24 3h48" stroke="#526579" strokeWidth="7" />
        <ellipse cx="158" cy="177" rx="12" ry="7" fill="#f5f8fa" />
        <path d="m226 200-40-32q-14-9-23-4-5 4 4 8l10 5-7 3q-5 4 0 7l29 13Z" fill="#dfb38f" />
      </>}
    </svg>
  );
}

export function TimeClockOptionsPanel({ roundingMinutes, onLaunch }: TimeClockOptionsProps) {
  return (
    <section className="panel settings-enforcement-panel settings-time-clock-panel">
      <div className="settings-panel-heading">
        <h3>Time clock options</h3>
        <button type="button" disabled>Save</button>
      </div>
      <p className="enforcement-intro">Track your team&apos;s time with the DomBase Time Clock. <button type="button" className="time-clock-link" disabled title={unavailable}>Learn more</button></p>

      <section className="time-clock-general" aria-labelledby="time-clock-general-title">
        <h4 id="time-clock-general-title">General</h4>
        <div className="enforcement-rules">
          <PlaceholderCheckbox label="Request employees to provide their shift experience at the end of their shift" checked />
          <PlaceholderCheckbox label="Require employees to declare cash tips at the end of their shift" />
          <div className="enforcement-rule-line time-clock-placeholder" title="Clock timestamp rounding is not available yet. Timesheets supports rounding total hours.">
            <label><input type="checkbox" checked disabled /><span>Round clock in and clock out times to the nearest</span></label>
            <select aria-label="Clock time rounding increment" value={roundingMinutes} disabled>
              {[5, 10, 15].map(minutes => <option value={minutes} key={minutes}>{minutes}</option>)}
            </select>
            <span>minute increment</span>
          </div>
        </div>
      </section>

      <section className="time-clock-option-card" aria-labelledby="mobile-clock-title">
        <div className="time-clock-option-content">
          <h4 id="mobile-clock-title"><PlaceholderCheckbox label="Mobile Time Clock" /></h4>
          <p>Allow employees to clock in/out via the DomBase mobile app. Capture GPS location for each clock in/out and break event. Works with or without scheduling.</p>
          <div className="time-clock-nested-options">
            <PlaceholderCheckbox label="Allow unscheduled shift clock-in from the mobile app" checked />
            <div>
              <PlaceholderCheckbox label="Enable Geo-fence" checked />
              <p>Limit employee mobile app clock-ins and clock-outs to a specific range around an address. One geofence per location.</p>
            </div>
          </div>
          <button type="button" className="time-clock-address" disabled title={unavailable}>Show address <span aria-hidden="true">⌄</span></button>
        </div>
        <div className="time-clock-option-preview">
          <ClockIllustration kind="mobile" />
          <button type="button" className="time-clock-link" disabled title={unavailable}>Text me a download link</button>
        </div>
      </section>

      <section className="time-clock-option-card" aria-labelledby="tablet-clock-title">
        <div className="time-clock-option-content">
          <h4 id="tablet-clock-title">Tablet Time Clock</h4>
          <p>Works on most Android and Apple tablets. Capture employee photos on clock-ins/outs and breaks. A solution for restaurants and retail.</p>
          <div className="time-clock-nested-options">
            <div>
              <PlaceholderCheckbox label="Unscheduled shift role selection" checked />
              <p>Allow employees who clock in to unscheduled shifts to select a role to assign to the shift. The employee&apos;s assigned roles will be displayed.</p>
            </div>
          </div>
        </div>
        <div className="time-clock-option-preview">
          <ClockIllustration kind="tablet" />
          <button type="button" className="time-clock-link" disabled title={unavailable}>Email me a download link</button>
        </div>
      </section>

      <section className="time-clock-option-card" aria-labelledby="web-clock-title">
        <div className="time-clock-option-content">
          <h4 id="web-clock-title">Web Time Clock</h4>
          <p>Use any computer browser as your time clock. This is a great option for offices, remote teams and service businesses.</p>
          <PlaceholderCheckbox label="Allow employees to launch the web time clock from their own computer" />
        </div>
        <div className="time-clock-option-preview">
          <ClockIllustration kind="web" />
          <button type="button" className="time-clock-link" onClick={onLaunch}>Launch Web Time Clock</button>
        </div>
      </section>
      <button type="button" className="time-clock-disable" disabled title={unavailable}>Disable time tracking</button>
    </section>
  );
}
