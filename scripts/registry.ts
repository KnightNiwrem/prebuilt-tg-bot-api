import type { PackedPackage } from "./assemble.ts";

/** Loopback-only registry for testing real npm tarballs before public publication. */
export function testRegistry(
  packages: PackedPackage[],
  tarballDirectory = "dist/packages",
  onTarball?: (name: string) => void,
): Deno.HttpServer<Deno.NetAddr> {
  const server: Deno.HttpServer<Deno.NetAddr> = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname).slice(1);
      const tarball = packages.find((pkg) => path === pkg.filename);
      if (tarball) {
        onTarball?.(tarball.name);
        return new Response(
          await Deno.readFile(`${tarballDirectory}/${tarball.filename}`),
          { headers: { "content-type": "application/octet-stream" } },
        );
      }
      const pkg = packages.find((pkg) => path === pkg.name);
      if (!pkg) return new Response("Not found", { status: 404 });
      return Response.json({
        name: pkg.name,
        "dist-tags": { latest: pkg.version },
        versions: {
          [pkg.version]: {
            ...pkg.manifest,
            dist: {
              tarball: `http://127.0.0.1:${server.addr.port}/${pkg.filename}`,
              integrity: pkg.integrity,
            },
          },
        },
      });
    },
  );
  return server;
}
