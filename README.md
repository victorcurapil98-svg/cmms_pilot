# GMAO · Asset Intelligence

Aplicación estática para explorar archivos CSV de órdenes de trabajo CMMS/GMAO, construir gráficos interactivos y exportar el informe con la opción de impresión del navegador.

## Uso local

Abre `index.html` en un navegador moderno y carga un CSV desde el botón **Cargar dataset** o arrastrando el archivo a la página. No necesita Python, Node, instalación de paquetes ni servidor. Los registros se procesan en el navegador y no se transmiten a ningún servicio.

Se aceptan CSV UTF-8 separados por coma, punto y coma o tabulador. Para obtener todos los indicadores, el archivo debe incluir `OT` y `Tipo_mantenimiento`. Las otras visualizaciones usan, cuando estén presentes, columnas como `Equipo`, `Tipo_equipo`, `Criticidad`, `Modo_falla`, `Downtime_h`, `Horas_mano_obra`, `Costo_total_CLP` y `Tiempo_reparacion_h`.

## Informe PDF

Carga un dataset, aplica los filtros deseados y pulsa **Exportar informe PDF**. En el diálogo de impresión selecciona **Guardar como PDF**. La vista impresa incluye los KPI, gráficos, priorización y notas metodológicas del conjunto filtrado.

## Publicar en GitHub Pages

Publica el contenido de `webapp/` como raíz del sitio desde la configuración **Settings → Pages → Deploy from a branch** (raíz del repositorio) copiándolo a la raíz de publicación, o configura una acción de Pages cuyo directorio de artefacto sea `webapp`. La aplicación no requiere API, credenciales ni backend.

La tipografía usa Google Fonts como mejora visual; si el navegador no tiene conexión, se usa la tipografía de respaldo del sistema. El resto de la aplicación y los datos no dependen de servicios externos.
