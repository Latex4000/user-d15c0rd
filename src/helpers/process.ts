import { execFile } from "node:child_process";

export function execFileAsync(file: string, args: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(file, args, (error, stdout) => {
            if (error != null) {
                reject(error);
                return;
            }

            resolve(stdout);
        });
    });
}
