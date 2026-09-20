# Local static server for public/. /media/* lives in R2 behind the Worker,
# so redirect those requests to the live site instead of 404ing.
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

LIVE = "https://carverse.de5.net"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/media/"):
            self.send_response(302)
            self.send_header("Location", LIVE + self.path)
            self.end_headers()
        else:
            super().do_GET()

    def end_headers(self):
        # Local edits must show on reload, never a stale cached JS/CSS.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ThreadingHTTPServer(("", port), partial(Handler, directory="public")).serve_forever()
