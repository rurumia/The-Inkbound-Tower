import {createServer} from "node:http";
import {readFile, stat} from "node:fs/promises";
import {extname, join, normalize} from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png"
};

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const file = normalize(join(root, relative));
    if (!file.startsWith(root)) throw new Error("Path outside server root.");
    if (!(await stat(file)).isFile()) throw new Error("Not a file.");
    response.writeHead(200, {"Content-Type": mime[extname(file).toLowerCase()] || "application/octet-stream"});
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, {"Content-Type": "text/plain; charset=utf-8"});
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`墨缚之塔开发服务器：http://127.0.0.1:${port}`);
});
