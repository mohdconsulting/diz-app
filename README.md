# Jobbmatch – webbprototyp

Matchar din profil (yrke, ort, kompetenser, CV) mot lediga jobb i Arbetsförmedlingens Platsbanken, föreslår ett personligt brev för varje annons och samlar allt du söker till underlag för **aktivitetsrapporten**. Svenska och arabiska (höger till vänster).

Prototyp: ingen server, ingen inloggning. Profil och sökta jobb sparas bara i webbläsaren (`localStorage`).

## Så funkar det
1. **Min profil** – yrke/jobb du söker, ort, kompetenser (komma-separerade), kontaktuppgifter och CV-text (klistra in eller ladda upp .txt).
2. **Jobb för mig** – appen hämtar annonser från JobTech JobSearch (`https://jobsearch.api.jobtechdev.se/search?q=<yrke ort>`), räknar en matchning 0–100 % och visar varför:
   - rätt yrke i rubriken/yrkesbenämningen (40)
   - dina kompetenser som nämns i annonsen (35)
   - ord från ditt CV som finns i annonsen (15)
   - rätt ort eller distans (10)
   Annonser under 15 % visas inte. Går API:t inte att nå visas påhittade **exempelannonser** (tydligt märkta).
3. **Skriv ansökan** – ett förslag på personligt brev (på svenska) byggt på annonsen och din profil. Kopiera, eller *Öppna annonsen och markera som sökt*.
4. **Sökta jobb** – lista per månad med datum, arbetsgivare, tjänst och ort. *Kopiera rapporten* eller *Ladda ner som Excel (CSV)* när du fyller i aktivitetsrapporten.

Appen skickar alltså **inte** CV:t automatiskt – de flesta annonser går till arbetsgivarens egna rekryteringssystem. Den hittar rätt jobb, skriver utkastet och håller ordning på vad du sökt.

## Köra lokalt
```bash
python3 -m http.server 8080      # i den här mappen
# öppna http://localhost:8080
```
Det går också att publicera mappen som den är på valfri statisk webbhosting (GitHub Pages, Netlify, Cloudflare Pages …).

## Filer
| Fil | Innehåll |
|---|---|
| `index.html`, `css/styles.css` | sidan |
| `js/app.js` | gränssnitt, hämtning, brev, rapport |
| `js/match.js` | matchning, brevmall, rapport/CSV (rena funktioner, testas i node) |
| `js/i18n.js` | texter svenska/arabiska |
| `js/demo-jobs.js` | påhittade exempelannonser |

## Tester
```bash
node tests/match.test.js     # matchning, brev, rapport
python3 tests/e2e.py         # hela flödet i Chromium (Playwright), med låtsas-API
```

## Nästa steg (förslag)
- AI-skrivet brev och anpassat CV per annons (Edge Function med språkmodell) i stället för mallen.
- Konto och synk mellan enheter (t.ex. Supabase), dagliga notiser om nya matchningar.
- Bättre matchning med JobTechs taxonomi (yrkes- och kompetens-id:n) och ort-id:n i stället för fritext.
- Fler språk (engelska, somaliska, dari/persiska, tigrinja), mobilappar.
