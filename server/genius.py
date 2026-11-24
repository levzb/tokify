"""Load a public Genius lyrics page with curl_cffi's Chrome transport. No API token or account cookies."""
import json
import sys
from urllib.parse import urlsplit


def main():
    url = sys.argv[1] if len(sys.argv) == 2 else ""
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != "genius.com" or not parsed.path.endswith("-lyrics"):
        raise ValueError("Only Genius lyrics pages can be loaded")
    try:
        from curl_cffi import requests
    except ImportError:
        raise RuntimeError("Genius page loading is not installed yet. Run: npm run setup") from None
    response = requests.get(url, impersonate="chrome", timeout=15, allow_redirects=False)
    if len(response.content) > 3 * 1024 * 1024:
        raise ValueError("The Genius page is too large")
    return {"status": response.status_code, "body": response.text}


if __name__ == "__main__":
    # stdout is a machine-readable reply to Node, including when a dependency or the network fails.
    try:
        result = main()
    except Exception as exc:
        result = {"error": str(exc)}
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))
