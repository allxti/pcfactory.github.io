// Copia y pega este código en Extensiones > Apps Script de tu Google Sheets

function doGet(e) {
  // Abre la hoja de cálculo activa
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Obtiene todos los datos de la hoja
  var data = sheet.getDataRange().getValues();
  
  // Array para guardar el resultado final
  var result = [];
  
  // Asumimos que la fila 1 (índice 0) tiene los encabezados
  var headers = data[0];
  
  // Recorremos desde la fila 2 (índice 1) en adelante
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var obj = {};
    
    // Si la fila está vacía (por ejemplo, sin título), nos la saltamos
    if (!row[0]) continue;
    
    // Mapeamos los encabezados con los valores
    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = row[j];
    }
    
    result.push(obj);
  }
  
  // Creamos la respuesta en formato JSON
  var jsonResponse = JSON.stringify(result);
  
  // Retornamos la respuesta configurada para ser leída por la web (evita problemas de CORS)
  return ContentService.createTextOutput(jsonResponse)
    .setMimeType(ContentService.MimeType.JSON);
}
