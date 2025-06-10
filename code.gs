  /**
 * Converts all pages of a PDF to PNG images and stores them in a temporary folder.
 * If the script fails at any point, the folder and its contents are deleted.
 *
 * @param {Blob} pdfBlob The PDF blob to convert to images.
 * @param {string} folderId The folder ID to store the temporary images.
 * @return {Blob[]} Array of PNG image blobs.
 */
async function convertPdfToImages(pdfBlob, folderId) {
  const cdnUrl = "https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js";
  eval(UrlFetchApp.fetch(cdnUrl).getContentText());

  // Convert PDF file into PDFLib object
  const pdfData = new Uint8Array(pdfBlob.getBytes());
  const pdfDoc = await PDFLib.PDFDocument.load(pdfData);
  const pageCount = pdfDoc.getPageCount();
  console.log(`Total pages: ${pageCount}`);

  const result = { imageBlobs: [], fileIds: [] };

  // Create a temporary folder to store images inside the provided folder
  // Fall back to the root folder if an invalid ID is supplied
  let tempFolder;
  try {
    const parentFolder = folderId ? DriveApp.getFolderById(folderId) : DriveApp.getRootFolder();
    tempFolder = parentFolder.createFolder('Temp_PDF_Images_' + new Date().getTime());
  } catch (e) {
    tempFolder = DriveApp.createFolder('Temp_PDF_Images_' + new Date().getTime());
  }
  console.log('Temporary folder created:', tempFolder.getId());

  // Loop through each page of the PDF
  for (let i = 0; i < pageCount; i++) {
    try {
      console.log(`Processing page: ${i + 1}`);
      const newPdfDoc = await PDFLib.PDFDocument.create();
      const [page] = await newPdfDoc.copyPages(pdfDoc, [i]);
      newPdfDoc.addPage(page);

      const pdfBytes = await newPdfDoc.save();
      const pdfBlob = Utilities.newBlob(
        [...new Int8Array(pdfBytes)],
        MimeType.PDF,
        `page_${i + 1}.pdf`
      );

      // Upload temporary PDF to Google Drive
      const fileId = tempFolder.createFile(pdfBlob).getId();
      Utilities.sleep(3000); // Wait for the thumbnail to be generated
      const thumbnailLink = Drive.Files.get(fileId, { fields: "thumbnailLink" }).thumbnailLink;

      if (!thumbnailLink) {
        throw new Error("Could not retrieve thumbnail link. Increase sleep time and try again.");
      }

      // Fetch the image and save as PNG
      const imageBlob = UrlFetchApp.fetch(thumbnailLink.replace(/\=s\d*/, "=s1000"))
        .getBlob()
        .setName(`page_${i + 1}.png`);

      result.imageBlobs.push(imageBlob);
      result.fileIds.push(fileId);
    } catch (error) {
      console.error(`Error processing page ${i + 1}: ${error.message}`);
    }
  }

  // Clean up: Trash the temporary files created in Drive
  result.fileIds.forEach((id) => DriveApp.getFileById(id).setTrashed(true));

  return { imageBlobs: result.imageBlobs, tempFolderId: tempFolder.getId() };
}

/**
 * Creates a Google Doc, adds images to each page, and saves it to the provided folder.
 * 
 * @param {Blob[]} imageBlobs Array of PNG image blobs to add to the Google Doc.
 * @param {string} folderId The folder ID to store the final document.
 * @return {string} The URL of the created Google Doc.
 */
function createGoogleDocWithImages(imageBlobs, folderId) {
  try {
    // Create a new Google Doc
    const newDoc = DocumentApp.create('Converted PDF to Doc');
    const docBody = newDoc.getBody();

    // Loop through each image blob and add to the document
    imageBlobs.forEach((imageBlob) => {
      const image = docBody.appendImage(imageBlob);
      image.setWidth(docBody.getPageWidth()); // Set image width to the page width
      image.setHeight(docBody.getPageHeight()); // Set image height to the page height
    });

    // Move the created document to the specified folder
    const folder = DriveApp.getFolderById(folderId);
    folder.addFile(DriveApp.getFileById(newDoc.getId())); // Save the document in the folder
    DriveApp.getRootFolder().removeFile(DriveApp.getFileById(newDoc.getId())); // Remove the original doc from the root folder

    console.log('Google Doc created successfully and added to folder!');
    return newDoc.getUrl(); // Return the URL of the new document
  } catch (error) {
    console.error('Error during Google Doc creation: ', error.message);
  }
}

/**
 * Main function to convert the PDF to images, create the Google Doc, and save everything to a folder.
 */
async function main() {
  try {
    const pdfFileId = ""; // Replace with your actual PDF file ID
    const folderId = ""; // Replace with your folder ID

    // Retrieve the PDF blob
    const pdfBlob = DriveApp.getFileById(pdfFileId).getBlob();
    
    // Convert PDF to images and get the temporary folder ID
    const { imageBlobs, tempFolderId } = await convertPdfToImages(pdfBlob, folderId);

    if (imageBlobs.length === 0) {
      console.log("No images were created.");
      return;
    }

    // Create a new Google Doc with images
    const docUrl = createGoogleDocWithImages(imageBlobs, folderId);

    // Cleanup: Delete the temporary folder and its contents after process
    DriveApp.getFolderById(tempFolderId).setTrashed(true);

    console.log('Process completed successfully! The document is available at: ', docUrl);
    return docUrl;

  } catch (error) {
    console.error('Error during the conversion process: ', error.message);
  }
}
