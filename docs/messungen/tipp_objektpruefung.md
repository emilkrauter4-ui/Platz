# „Kein Objekt gefunden“ (2026-10-10)

Regel (tipp.kein_objekt): SAM-Score < 0.2 und P(nichts) ≥ 0.99, nur ohne vom Nutzer
gewählte Klasse (in der App immer: die Art wird erst nach dem Tipp gewählt). Gewählt auf dev, test nur gemessen.
Tipps auf alle annotierten Objekte der 60 Referenz-Grundstücke (Objektmitte) und je Grundstück 3 leere Stellen
(≥ 1,5 m von jedem annotierten Objekt und jedem Gebäude). Gezählt sind Tipps, bei denen SAM überhaupt einen Umriss liefert.

| | dev: abgelehnt | test: abgelehnt |
|---|---|---|
| leere Stelle | 8 von 101 (8 %) | 2 von 54 (4 %) |
| Bau/Pool/Trampolin | 0 von 30 (0 %) | 0 von 8 (0 %) |
| Vegetation/Terrasse/Zaun | 4 von 98 (4 %) | 3 von 55 (5 %) |

Ehrlich: Die Regel ist vorsichtig. Sie lehnt fast keine echten Bauten ab, erkennt aber nur einen kleinen Teil
der leeren Stellen. SAM findet fast immer irgendeine zusammenhängende Fläche (Pflaster, Beet, Teil eines Nachbarobjekts),
und der Klassifikator sagt auch bei vielen echten Gartenhäusern „nichts“ (er ist auf Kandidaten der Vollautomatik
trainiert, nicht auf Tipps). Wer auf eine leere Stelle tippt, bekommt deshalb meist trotzdem einen Umriss – mit
Label „erfasst per Tipp“ und der Frage „Stimmt der Umriss?“.
