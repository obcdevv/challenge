class POW {
    constructor(publicSalt, difficulty, challenge, numeric = true) {
        this.workers = [];
        this.challenge = challenge;
        this.difficulty = difficulty;
        this.publicSalt = publicSalt;
        this.navigatorData = this.cloneObject(navigator, 0);
        this.numeric = numeric;

        this.workerScript = `
        self.onmessage = async function(e) {
            const { publicSalt, challenge, start, end, numeric, difficulty, clientNavigator } = e.data;

            function compareObj(obj1, obj2, depth = 0) {
                if (depth > 4) return "";
                let mismatches = [];
                for (let key in obj1) {
                    if (key === "rtt") continue;
                    if (typeof obj1[key] === "function") continue;
                    if (typeof obj1[key] === "object" && obj1[key] !== null) {
                        const sub = compareObj(obj1[key], obj2[key], depth + 1);
                        if (sub) mismatches.push(sub);
                    } else if (obj1[key] !== obj2[key]) {
                        mismatches.push(key);
                    }
                }
                return mismatches.join(", ");
            }

            function incrementHexString(str) {
                const chars = '0123456789abcdef';
                let carry = 1;
                let res = '';
                for (let i = str.length - 1; i >= 0; i--) {
                    let index = chars.indexOf(str[i]) + carry;
                    if (index >= chars.length) {
                        index = 0;
                        carry = 1;
                    } else {
                        carry = 0;
                    }
                    res = chars[index] + res;
                }
                return carry ? '0' + res : res;
            }

            function getStringByIndex(index, length) {
                const chars = '0123456789abcdef';
                let res = '';
                for (let i = 0; i < length; i++) {
                    res = chars[index % chars.length] + res;
                    index = Math.floor(index / chars.length);
                }
                return res.padStart(length, '0');
            }

            async function sha256(message) {
                const msgBuffer = new TextEncoder().encode(message);
                const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
                const hashArray = Array.from(new Uint8Array(hashBuffer));
                return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            }

            let resp = { match: compareObj(navigator, clientNavigator), solution: "", access: "" };

            if (numeric) {
                for (let i = start; i <= end; i++) {
                    if ((await sha256(publicSalt + i)) === challenge) {
                        resp.solution = i;
                        resp.access = await sha256(i.toString() + publicSalt);
                        self.postMessage(resp);
                        self.close();
                        return;
                    }
                }
            } else {
                for (let i = start; i <= end; i++) {
                    let current = getStringByIndex(i, difficulty);
                    if ((await sha256(publicSalt + current)) === challenge) {
                        resp.solution = current;
                        resp.access = await sha256(current + publicSalt);
                        self.postMessage(resp);
                        self.close();
                        return;
                    }
                }
            }

            self.postMessage(resp);
            self.close();
        };
        `;
    }

    cloneObject(obj, depth) {
        let clone = {};
        if (depth > 4) return clone;
        for (let key in obj) {
            if (typeof obj[key] !== "object" || obj[key] === null || obj[key] instanceof Function) {
                if (typeof obj[key] !== "function" && !(obj[key] instanceof HTMLElement)) {
                    clone[key] = obj[key];
                }
            } else {
                clone[key] = this.cloneObject(obj[key], depth + 1);
            }
        }
        return clone;
    }

    spawnWorker(url, start, end) {
        return new Promise((resolve) => {
            const worker = new Worker(url);
            this.workers.push(worker);

            worker.onmessage = event => {
                const data = event.data;
                if (data.solution !== "") {
                    this.workers.forEach(w => w.terminate());
                    resolve(data);
                } else {
                    resolve(null);
                }
            };

            worker.postMessage({
                challenge: this.challenge,
                publicSalt: this.publicSalt,
                start,
                end,
                numeric: this.numeric,
                difficulty: this.difficulty,
                clientNavigator: this.navigatorData
            });
        });
    }

    async Solve() {
        const cores = Math.min(navigator.hardwareConcurrency || 2, 16);
        console.log(`🤔 Starting solve with ${cores} workers`);

        const max = this.numeric ? this.difficulty : Math.pow(16, this.difficulty);
        const chunkSize = Math.ceil(max / cores);

        const blob = new Blob([this.workerScript], { type: "text/javascript" });
        const url = URL.createObjectURL(blob);

        const promises = [];
        for (let i = 0; i < max; i += chunkSize) {
            promises.push(this.spawnWorker(url, i, Math.min(i + chunkSize - 1, max - 1)));
        }

        try {
            const startTime = Date.now();
            const result = await Promise.any(promises);
            const endTime = Date.now();
            console.log("🥳 Heureka", result);
            console.log("Solved in:", (endTime - startTime) / 1000, "seconds");
            return result;
        } catch (err) {
            console.log("🕵️ No worker found a solution", err);
            return null;
        }
    }
}
