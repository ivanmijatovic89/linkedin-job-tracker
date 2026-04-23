# LinkedIn Jobs Tracker — TODO

Redosled rada (po dogovoru):
1. Feature #4

---

## 1) Feature #4 — "About the job" ekstrakcija iz desne strane

**Cilj:**  
Izvući kompletan tekst sekcije **About the job** za aktivni job u desnom panelu.

**Šta treba da radi:**
- Na aktivnom desnom panelu pronaći sekciju "About the job".
- Izvući full tekst (normalizovan whitespace, bez duplih praznina).
- Sačuvati u storage pod npr. `about_job` (ili dogovoreni key).
- Ako sekcija ne postoji, sačuvati prazno i ne rušiti tok.

---

## Završeno

### Feature #1 — Broj oglasa po kompaniji

- Implementirano u panelima (levo + desno): `C:<total>=❌<skip>+✅<applied>`
- Brojanje je `status != None`
- Company match je strict `company_slug`

### Feature #2 — Broj oglasa za istu poziciju unutar kompanije

- Implementirano u panelima (levo + desno): `R:<total>`
- Match je strict `company_slug + title`
- Detaljan breakdown po statusima je u tooltip-u
