import http.server
import os
import threading
import webbrowser

PORTA = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    # O registro do Windows às vezes informa tipos errados para .js/.wasm, o que quebra o navegador.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".css": "text/css",
    }

    def log_message(self, *args):
        pass


os.chdir(os.path.dirname(os.path.abspath(__file__)))
servidor = http.server.ThreadingHTTPServer(("127.0.0.1", PORTA), Handler)
url = f"http://localhost:{PORTA}/"
print(f"Cronometro rodando em {url}")
print("Mantenha esta janela aberta durante o treino. Feche-a para encerrar.")
threading.Timer(1, lambda: webbrowser.open(url)).start()
servidor.serve_forever()
