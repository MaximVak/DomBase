"use client";
import type { ScheduleSelection, ScheduleToolRole } from "./schedule-tools-model";
import type { Department, Employee } from "../workforce/model";
export function ScheduleToolsSelection({ value, onChange, departments, employees, roles, disabled }: { value: ScheduleSelection; onChange: (value: ScheduleSelection) => void; departments: Department[]; roles: ScheduleToolRole[]; employees: Employee[]; disabled: boolean }) {
  return <fieldset className="schedule-tool-selection" disabled={disabled}><legend>Include in this operation</legend>
    <label>Department<select value={value.departmentId ?? ""} onChange={event => onChange({ ...value, departmentId: event.target.value ? Number(event.target.value) : null, roleId: null })}><option value="">All departments you can manage</option>{departments.map(department => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
    <label>Job role<select value={value.roleId ?? ""} onChange={event => onChange({ ...value, roleId: event.target.value ? Number(event.target.value) : null })}><option value="">All roles in the selection</option>{roles.filter(role => value.departmentId === null || role.departmentId === value.departmentId).map(role => <option value={role.id} key={role.id}>{role.name}</option>)}</select></label>
    <label className="schedule-tool-check"><input type="checkbox" checked={value.employeeIds === null} onChange={event => onChange({ ...value, employeeIds: event.target.checked ? null : [] })} />All team members in the selection</label>
    {value.employeeIds !== null ? <div className="schedule-tool-people">{employees.filter(employee => employee.active && !employee.terminated).map(employee => <label className="schedule-tool-check" key={employee.id}><input type="checkbox" checked={value.employeeIds!.includes(employee.id)} onChange={event => onChange({ ...value, employeeIds: event.target.checked ? [...value.employeeIds!, employee.id] : value.employeeIds!.filter(id => id !== employee.id) })} />{employee.name}</label>)}</div> : null}
    <p>Calendar filters do not change this selection. Other departments and team members stay outside it.</p>
  </fieldset>;
}
