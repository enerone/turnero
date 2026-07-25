# Turnero — contexto del proyecto

Agenda con confirmación automática de turnos para estudios profesionales argentinos
(escribanías, estudios jurídicos y contables, consultorios). Se distribuye a través de la
cartera de un socio comercial: ~2000 pymes. Equipo: dos personas a tiempo parcial.

**Qué resuelve:** el ausentismo. Bajar del 20% al 8% recupera el abono muchas veces. Es el
único número que justifica cobrar USD 35–40 en vez de USD 15.

Es el producto de entrada de una plataforma modular. El asistente conversacional es un
producto separado que se apoya en éste: **el turnero expone la API, el asistente la
consume.** Nunca duplicar lógica de agenda del otro lado.

---

## Tres superficies web, prioridad por frecuencia de uso

**1. Página pública de reserva** — la más usada de todas (cientos de personas al mes contra
un solo profesional) y la más simple.

- Sin login, sin cuenta, sin instalar nada. El cliente final entra, ve horarios, toca uno.
- Mobile-first absoluto, pensada para Android viejo con señal mala.
- Tiene que cargar rápido de verdad: es la única pantalla donde el usuario no tiene ningún
  incentivo para esperar. Una reserva lenta es una reserva perdida.
- Es también superficie de marketing: lleva el nombre del estudio y tiene que verse lo
  suficientemente bien como para que el profesional no tenga vergüenza de mandar ese link.

**2. Operación diaria** — dos layouts distintos, no el mismo comprimido.

- En celular: **lista** de "qué tengo hoy", próximo turno arriba, teléfono del cliente a un
  toque. Una grilla semanal achicada es ilegible; no intentarlo.
- En escritorio: grilla semanal densa, con drag para mover turnos. Es la vista de la
  secretaria.

**3. Configuración** — la pantalla **menos** usada del producto.

- El cliente la toca tres veces en su vida: alta, cambio de horario, servicio nuevo.
- Completa y clara, responsive básica. No invertir esfuerzo mobile acá.

---

## Reglas del dominio

**Confirmación del cliente final por link con token, nunca por cuenta.** Si hay que
registrarse para confirmar un turno, se pierde la confirmación.

**Los recordatorios se derivan del turno, no se copian.** Si el turno se mueve, el aviso se
recalcula solo. Guardarlos como registros independientes genera avisos huérfanos y
duplicados durante meses. Es el componente que más va a doler: tratarlo con cuidado.

**La cancelación libera el turno automáticamente.** Ese circuito completo es el ROI que se
vende.

**Sync bidireccional con Google Calendar.** Sin esto el producto no existe: nadie mantiene
dos agendas. Los canales de notificación vencen y hay que renovarlos; los eventos
recurrentes son el caso difícil; los conflictos de edición simultánea necesitan una regla
explícita escrita, no un comportamiento emergente.

**Multi-tenant:** el aislamiento se aplica en el filtro de la query, nunca en el prompt ni
en la capa de presentación. Datos de un cliente apareciendo en la vista de otro termina el
negocio. Desde el día uno, cuando cuesta nada.

**Zona horaria:** `America/Argentina/Buenos_Aires` explícita en todo datetime, nunca naive.
Renderizar siempre en la zona del profesional y decirlo en pantalla — alguien va a reservar
desde otra provincia o desde afuera.

**WhatsApp:** sólo Cloud API oficial, para los avisos salientes. Nunca librerías no
oficiales (Baileys, whatsapp-web.js): un ban le mata el canal comercial al cliente y con él
la relación con todo el canal de distribución. No es una preferencia, es una condición del
negocio.

---

## Onboarding: configuración derivada, no preguntada

Sólo se le preguntan tres cosas al cliente el primer día: horario de atención, duración
típica y número para los avisos.

Todo lo demás se deduce: la agenda del OAuth de Calendar, los contactos del primer turno de
cada persona, la duración de las correcciones del usuario (proponer 30 minutos y dejar de
preguntar si corrige tres veces a 45).

Un panel de configuración casi vacío al inicio es señal de buen diseño en este producto.

---

## Fuera de alcance, a propósito

No agregar aunque parezca fácil o aunque el cliente lo pida:

- **App nativa / Flutter.** Las superficies son web y WhatsApp. Una app agrega fricción de
  instalación justo donde menos se la puede pagar: el cliente final. Si más adelante se
  quiere sensación de app (ícono, push), va por PWA — mismo código, sin tiendas ni review.
- **Personalización visual del link de reserva** más allá del nombre y un color. Es lo
  primero que van a pedir y lo que menos mueve la aguja.
- **Configuración por WhatsApp.** Cargar horarios de atención conversando es un suplicio.
  Eso es un formulario y siempre lo va a ser.
- **Historias clínicas.** Datos sensibles de salud, con obligaciones que este equipo no
  puede cubrir hoy. A los médicos se les vende agenda y confirmaciones sin tocar un dato
  clínico.
- **Microservicios, Kubernetes, colas distribuidas.** La escala no lo pide: una tabla de
  jobs y un cron alcanzan.

---

## Convenciones

- **Todo el texto de cara al usuario en español rioplatense**, con voseo y tono directo.
  Nada de "usted", nada de traducciones literales del inglés.
- Nombres de dominio en español (`turno`, `disponibilidad`, `recordatorio`). No mezclar
  inglés y español en el mismo módulo.
- Los mensajes al usuario son cortos. Cabe en una notificación de WhatsApp o no sirve.

---

## Orden de construcción

Cada etapa tiene criterio de salida. No se avanza sin cumplirlo.

1. **Núcleo** — modelo de datos, multi-tenant, sync con Google Calendar, panel web con
   grilla y lista.
   *Salida:* la agenda funciona sola.
2. **Circuito del cliente final** — página pública de reserva, recordatorio, confirmación
   por respuesta, liberación automática al cancelar.
   *Salida:* un turno completo de punta a punta sin intervención manual.
3. **Cierre** — resumen semanal al profesional, adjuntos por contacto y turno, onboarding
   autoservicio.
   *Salida:* un cliente nuevo se da de alta sin llamada.

La capa conversacional **no va acá**: es el otro producto, y se construye después de que
esto funcione.

---

## Qué medir

- Reducción del ausentismo en los primeros diez clientes → es el número que habilita subir
  el precio, y el único que importa de verdad
- Activación a 7 días y uso semanal
- Churn mensual (referencia: 5% es lo esperable en abonos chicos)
- Tickets de soporte por cliente por mes
- MRR sostenido por hora mensual de mantenimiento → la métrica que ordena el roadmap

**Puerta para empezar el producto siguiente:** 20 clientes pagando, tres meses con
retención sobre 85%, y menos de 0,3 tickets por cliente por mes. Si no se llega, el
producto nuevo no lo arregla: da dos cosas rotas en vez de una.
