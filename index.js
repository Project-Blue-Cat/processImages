'use strict';
const config = require('./config.json');

// Get a reference to the Pub/Sub component
const pubsub = require('@google-cloud/pubsub')();
// Get a reference to the Cloud Storage component
const storage = require('@google-cloud/storage')();
// Get a reference to the Cloud Vision API component
const vision = require('@google-cloud/vision')();

const Buffer = require('safe-buffer').Buffer;

/**
 * Publishes the result to the given pubsub topic and returns a Promise.
 *
 * @param {string} topicName Name of the topic on which to publish.
 * @param {object} data The message data to publish.
 */
function publishResult(topicName, data) {
    return pubsub.topic(topicName).get({autoCreate: true})
        .then(([topic]) => topic.publish(data));
}

/**
 * Cloud Function triggered by Cloud Storage when a file is uploaded.
 *
 * @param {object} event The Cloud Functions event.
 * @param {object} event.data A Google Cloud Storage File object.
 */
exports.processImage = function processImage(event) {
    // let file = event.data;
    console.log("event in ");
    console.log(event);

    console.log("event data is trying to be processed");

    var base64Data = event.data.data;

    var data = Buffer.from(base64Data, 'base64').toString();

    console.log(data);
    var dataJson = JSON.parse(data);
    console.log("image location ");
    console.log(dataJson.imageLocation);


    return Promise.resolve()
        .then(() => {
            return getImages();
        })
        .then((files) => {

            console.log("files in the then statement before processing");
            console.log(files);

            files.forEach(file => {
               runVisionAPI(file);
            });


            return; //runVisionAPI(files[0]);
        })
        .then(() => {
            console.log(`File processed.`);
        });

};

function getImages() {

    let fileNames = [];

    return Promise.resolve()
        .then(() => {
            return storage.bucket("project-blue-cat-images").getFiles({
                autoPaginate: false
            });
        })
        .then((data) => {

            data[0].forEach(x => {
                console.log(x.name);
                fileNames.push(x.name);
            });

            console.log("filenames to be returned");
            console.log(fileNames);

            return fileNames;
        });


    // return storage.bucket("project-blue-cat-images").getFiles(function (err, files) {
    //
    //     files.forEach(x => {
    //         console.log(x.name);
    //         fileNames.push(x.name);
    //     });
    //     console.log("filenames about to be returned");
    //     console.log(fileNames);
    //     console.log(fileNames[0]);
    //
    //     return fileNames;
    // });

}

/**
 * Detects various different properties using the Google Vision API.
 *
 * @param {object} file Cloud Storage File instance.
 * @returns {Promise}
 */
function runVisionAPI(file) {
    let text;

    console.log("in vision API");

    // var image = {
    //     source: {imageUri: 'gs://' + "project-blue-cat-images" + '/' + file.name}
    // };

    var image = {
        source: {imageUri: 'gs://' + "project-blue-cat-images" + '/' + file}
    };

    return vision.textDetection(image)
        .then((results) => {
            console.log("ocr results ");
            console.log(results);

            if (results[0].fullTextAnnotation != null) {
                text = results[0].fullTextAnnotation.text;
            }

            // var documentData = {
            //     text: text,
            //     filename: file.name,
            //     labels: [],
            //     faces: []
            // };

            var documentData = {
                text: text,
                filename: file,
                labels: [],
                faces: []
            };


            return documentData;
        })
        /** Safe Search Detection on image */
        .then((documentData) => {
            console.log("processing safety");
            return findImageSafety(image, documentData);
        })
        // /** Label Detection */
        // .then((documentData) => {
        //     console.log("processing labels");
        //     return findLabels(image, documentData);
        // })
        // .then((documentData) => {
        //     console.log("processing faces");
        //     return findFaces(image, documentData)
        // })
        /** Publish the image */
        .then((messageData) => {
            console.log("message data");
            console.log(messageData);
            return publishResult(config.RESULT_TOPIC, messageData);
        });


}


/**
 * Detects the different image characteristics to determine if the image has inappropriate content.
 *
 * @param {object} file Cloud Storage file instance
 * @returns {Promise}
 */
function findImageSafety(image, documentData) {

    return Promise.resolve()
        .then(() => {
            return vision.safeSearchDetection(image);
        })
        .then((results) => {

            console.log("results are ");
            console.log(results);

            const detections = results[0].safeSearchAnnotation;

            console.log(`Adult: ${detections.adult}`);
            console.log(`Spoof: ${detections.spoof}`);
            console.log(`Medical: ${detections.medical}`);
            console.log(`Violence: ${detections.violence}`);

            documentData.adult = detections.adult;
            documentData.spoof = detections.spoof;
            documentData.medical = detections.medical;
            documentData.violence = detections.violence;

            return documentData;
        })
        .catch((err) => {
            console.error('Vision API failure when finding image safety', err);
        });


    // return Promise.resolve();

}

/**
 * Detects various attributes within the image.
 *
 * @param file
 * @param documentData
 */
function findLabels(file, documentData) {
    return vision.labelDetection(file)
        .then((results) => {

            const labels = results[0].labelAnnotations;

            labels.forEach((label) => documentData.labels.push(label.description));

            return documentData;
        })
        .catch((err) => {
            console.error('ERROR:', err);
        });

    return Promise.resolve();
}

/**
 * Detects faces, facial key points, and emotional likelihoods in an image.)
 *
 * @param file
 * @param documentData
 */
function findFaces(image, documentData) {
    return vision.faceDetection(image)
        .then((results) => {
            const faces = results[0].faceAnnotations;

            faces.forEach((face, i) => {
                console.log(`  Face #${i + 1}:`);
                console.log(`    Joy: ${face.joyLikelihood}`);
                console.log(`    Anger: ${face.angerLikelihood}`);
                console.log(`    Sorrow: ${face.sorrowLikelihood}`);
                console.log(`    Surprise: ${face.surpriseLikelihood}`);

                var curr = new Object();
                curr.joy = face.joyLikelihood;
                curr.anger = face.angerLikelihood;
                curr.sorrow = face.sorrowLikelihood;
                curr.surprise = face.surpriseLikelihood;

                documentData.faces.push(curr);
            });

            return documentData;
        })
        .catch((err) => {
            console.error('ERROR:', err);
        });

    return Promise.resolve();
}


/**
 * Appends a .txt suffix to the image name.
 *
 * @param {string} filename Name of a file.
 * @param {string} lang Language to append.
 * @returns {string} The new filename.
 */
function renameImageForSave(filename) {
    return `${filename}.txt`;
}

function saveAll(file, payload) {
    console.log(payload);

    var ocrString = "";
    if (payload.text != null) {
        // file.save("ocr : " + payload.text + " ");
        ocrString = "ocr : " + payload.text;
    }

    var faceString = "";
    (payload.faces).forEach(face => {
        faceString += "\nfacejoy" + face.joy +
            "\nfaceanger" + face.anger +
            "\nfacesorrow" + face.sorrow +
            "\nfacesurprise" + face.surprise
    });

    var labelString = "";
    (payload.labels).forEach(label => {
        labelString += "\nlabel" + label;
    });

    file.save(
        "\n" + ocrString +
        "\nimageadult" + payload.adult +
        "\nimagespoof" + payload.spoof +
        "\nimagemedical" + payload.medical +
        "\nimageviolence" + payload.violence +
        labelString +
        faceString
    );

}

/**
 * Saves the data packet to a file in GCS. Triggered from a message on a Pub/Sub
 * topic.
 *
 * @param {object} event The Cloud Functions event.
 * @param {object} event.data The Cloud Pub/Sub Message object.
 * @param {string} event.data.data The "data" property of the Cloud Pub/Sub
 * Message. This property will be a base64-encoded string that you must decode.
 */
exports.saveResult = function saveResult(event) {
    const pubsubMessage = event.data;
    const jsonStr = Buffer.from(pubsubMessage.data, 'base64').toString();
    const payload = JSON.parse(jsonStr);
    console.log("in save result");
    return Promise.resolve()
        .then(() => {

            if (!payload.filename) {
                throw new Error('Filename not provided. Make sure you have a "filename" property in your request');
            }

            const bucketName = config.RESULT_BUCKET;
            const filename = renameImageForSave(payload.filename);

            console.log("trying to save : " + filename);

            const file = storage.bucket(bucketName).file(filename);

            console.log(`Saving result to ${filename} in bucket ${bucketName}`);

            return saveAll(file, payload);

        })
        .then(() => {
            console.log(`File saved.`);
        });
};
