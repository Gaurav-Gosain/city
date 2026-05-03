import { serve } from "bun";
import index from "./index.html";

const server = serve({
  routes: {
    "/city.glb": () =>
      new Response(Bun.file(import.meta.dir + "/assets/city2.glb"), {
        headers: {
          "Content-Type": "model/gltf-binary",
          "Cache-Control": "public, max-age=3600",
        },
      }),

    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },

    // Serve index.html for all unmatched routes (must be last).
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
