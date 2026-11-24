# Asks Shazam what is playing in the audio clips given on the command line (cut by server/lyrics.js) and prints
# a JSON list with one object per clip it asked about: {"title", "artist", "key", "lyrics"}, {} or {"error"}.
# Clips go one by one and it stops as soon as two agree: Shazam answers parallel requests with "too many
# requests", and the library's default is to retry those for up to a minute.
# Runs in the virtualenv that setup creates in data/tools/shazam (pip install shazamio).
import asyncio, json, sys
from aiohttp_retry import ExponentialRetry
from shazamio import Shazam, HTTPClient, RateLimited

def pick(out):
    track = (out or {}).get('track') or {}
    if not track.get('title'):
        return {}
    lyrics = []
    for section in track.get('sections') or []:
        if section.get('type') == 'LYRICS':
            lyrics = section.get('text') or []
    return {'title': track.get('title'), 'artist': track.get('subtitle') or '', 'key': track.get('key') or '',
            'lyrics': '\n'.join(lyrics)}

async def main(files):
    client = HTTPClient(retry_options=ExponentialRetry(attempts=3, start_timeout=0.5, max_timeout=3,
                                                       statuses={500, 502, 503, 504}))
    shazam = Shazam(http_client=client)
    results, votes = [], {}
    try:
        for f in files:
            try:
                r = pick(await shazam.recognize(f))
            except RateLimited:  # asking again while throttled only keeps the block going
                results.append({'error': 'rate limited'})
                break
            except Exception as e:  # one bad clip must not hide the others
                r = {'error': f'{type(e).__name__}: {str(e)[-160:]}'}
            results.append(r)
            if r.get('key'):
                votes[r['key']] = votes.get(r['key'], 0) + 1
                if votes[r['key']] >= 2:
                    break
    finally:
        try:
            await client.close()
        except Exception:
            pass
    print(json.dumps(results, ensure_ascii=False))

asyncio.run(main(sys.argv[1:]))
