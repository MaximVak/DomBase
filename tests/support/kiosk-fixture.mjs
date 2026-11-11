import { seedAccessFixture } from "./access-fixture.mjs";
export const employeePin = "246813";
export const otherEmployeePin = "135792";
export const managerPin = "864213";
export const ownerPin = "975312";
export async function seedKioskFixture(db, schema, loadServerModule, password) {
  return seedAccessFixture(db, schema, loadServerModule, password);
}
export function cookiesOf(response) {
  return response.headers.getSetCookie().map(value => value.split(";")[0]);
}
