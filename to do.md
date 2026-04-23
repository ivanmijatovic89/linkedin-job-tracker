# LinkedIn Jobs Tracker — TODO

Redosled rada (po dogovoru):
1. Feature #4
2. Feature #1
3. Feature #2

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

## 2) Feature #1 — Broj oglasa po kompaniji (u desnom panelu)

**Cilj:**  
Prikazati u desnom panelu koliko oglasa iz baze imamo za tu kompaniju.

**Šta treba da radi:**
- Za otvoreni job odrediti kompaniju (po mogućnosti preko `company_slug`, fallback `company`).
- Prebrojati sve zapise u bazi koji pripadaju toj kompaniji.
- Prikazati mali indikator u panelu, npr: `Company jobs: 12`.

---

## 3) Feature #2 — Broj oglasa za istu poziciju unutar kompanije

**Cilj:**  
Prikazati u desnom panelu koliko oglasa iz baze imamo za **istu poziciju** u toj kompaniji.

**Šta treba da radi:**
- Definisati match pravilo za "istu poziciju":
  - normalizovan `title` + kompanija (slug prioritetno).
- Prebrojati odgovarajuće zapise.
- Prikazati indikator, npr: `Same role in company: 4`.

---

## Otvorena pitanja (pre implementacije)

1. Da li želiš da se brojanje radi nad **svim statusima** (`None`, `Seen`, `To Apply`, `Applied`, `Skip`) ili samo nad tracked statusima (`!= None`)?
2. Za "istu poziciju" da li želiš striktno poređenje title-a, ili blagu normalizaciju (npr. ukloniti `(m/f/d)`, višak razmaka, velika/mala slova)?
3. Da li `about_job` treba da se prikazuje i u dashboard-u, ili za sada samo da se čuva u storage?
