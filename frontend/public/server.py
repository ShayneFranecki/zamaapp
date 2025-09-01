#!/usr/bin/env python3
import http.server
import socketserver
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

class CORSRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200, "ok")
        self.end_headers()

if __name__ == "__main__":
    PORT = 3012
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    
    with socketserver.TCPServer(("", PORT), CORSRequestHandler) as httpd:
        print(f"=== ZeroDrop Frontend Server ===")
        print(f"Server started at http://localhost:{PORT}")
        print(f"Open your browser to: http://localhost:{PORT}")
        print("Press Ctrl+C to stop the server")
        print()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")