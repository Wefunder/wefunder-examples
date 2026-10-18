// Every setting the server needs, read once. A missing token fails at the first mint rather than
// as a confusing 401 from Wefunder.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: copy .env.example to .env and fill it in`);
  return v;
}

// `||`, not `??`: a variable that exists but is EMPTY must fall back too.
const optional = (name: string) => process.env[name] || undefined;

export const env = {
  get installToken() { return required("WEFUNDER_INSTALL_TOKEN"); },
  get offeringIds() { return required("WEFUNDER_OFFERING_IDS").split(",").map((s) => s.trim()).filter(Boolean); },
  returnUrl: process.env.RETURN_URL || "wefunderexample://invest/return",
  apiBase: optional("WEFUNDER_API_BASE"),
  port: Number(process.env.PORT || 4181),
};
