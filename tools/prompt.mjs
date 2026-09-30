// Leest het wachtwoord uit GD_PASSWORD, of vraagt het verborgen in de terminal.
import readline from "node:readline";

export function getPassword(label = "Wachtwoord: ") {
  if (process.env.GD_PASSWORD) return Promise.resolve(process.env.GD_PASSWORD);
  if (!process.stdin.isTTY) {
    console.error("Geen interactieve terminal: zet GD_PASSWORD of draai dit in een eigen terminalvenster.");
    process.exit(1);
  }
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(label)) rl.output.write(label); };
    // resolve vóór close: close() vuurt 'close' synchroon, en dat mag het antwoord niet overschrijven.
    rl.question(label, pw => { resolve(pw); rl.close(); process.stdout.write("\n"); });
    rl.on("close", () => resolve(""));
  });
}
