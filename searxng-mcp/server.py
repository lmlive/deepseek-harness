import json
import os
import urllib.request
import urllib.parse
from mcp.server.mcpserver import MCPServer

server = MCPServer("searxng-search")
SEARXNG_BASE_URL = os.environ.get("SEARXNG_BASE_URL", "http://100.101.179.90:8888").rstrip("/")

@server.tool()
def searxng_web_search(query: str, limit: int = 5) -> str:
    """Search the web using the local/remote SearXNG instance."""
    url = f"{SEARXNG_BASE_URL}/search?q={urllib.parse.quote(query)}&format=json"
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "MCP-SearXNG/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            results = data.get("results", [])[:limit]
            if not results:
                return "No results found."
            formatted = []
            for r in results:
                title = r.get("title", "")
                link = r.get("url", "")
                content = r.get("content", "")
                formatted.append(f"Title: {title}\nURL: {link}\nSnippet: {content}\n")
            return "\n---\n".join(formatted)
    except Exception as e:
        return f"Error querying SearXNG: {e}"

if __name__ == "__main__":
    server.run("stdio")
