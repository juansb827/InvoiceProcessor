"use strict";
require("dotenv").config({ path: "./serverless.env" });

const AWS          = require("aws-sdk");
const workerManager = require('./workerManager');
const { getConfParameters } = require('./../../lib/confParameters');


const AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION;
AWS.config.update({ region: AWS_DEFAULT_REGION });
const s3 = new AWS.S3();

let confParameters = null;

module.exports.processPendingEmails =  (async function (event, context)   {
  context.callbackWaitsForEmptyEventLoop = false; 

  const response = {
    statusCode: 200,
    body: JSON.stringify({
      message: "SQS event processed."      
    })
  };

  confParameters = await getConfParameters(
    'gapi_client_id',
    'gapi_client_secret',
    'pg_encrypt_password'
  );
  const emailAccount = event.Records[0].body;//'juansb827@gmail.com' //

  try {
    await workerManager.attempToStartWorker(emailAccount, 15, 1, confParameters.pg_encrypt_password);   
  }catch(err ) {
    console.error("Error in worker for account: " + emailAccount + " " + err.stack);
    return err;
  }
  
  console.log('Function ends');
  return response;
 
});



