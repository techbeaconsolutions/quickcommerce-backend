export function log(message, ...args) {
  console.log(`[${new Date().toISOString()}]`, message, ...args);
}
