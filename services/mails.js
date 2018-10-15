require('dotenv').config();
const Promise = require('bluebird');
const crypto = require("crypto");

const { sequelize } = require('../db/models');
const { Email, Attachment } = require('../db/models');
const EmailHelper = require('./Email/ImapHelper')

const ImapConnections = require('./Email/ImapConnections');
const connectionsHelper = new ImapConnections();

const async = require('async');
var fs = require('fs'), fileStream;

searchEmails().then(mailIds => {
    console.log("Finished:##", mailIds);
})
    .catch(err => {
        console.log("Could not download emails", err);
    });


//TODO: Should be called by route

async function searchEmails(searchParams) {

    const connection = await connectionsHelper.getConnection('juansb827@gmail.com');


    //if (1==1 )return ['3:v'];
    //'notifications@github.com'
    let emailIds = await EmailHelper.findEmailIds(connection, 'September 20, 2018', 'focuscontable@gmail.com');
    await connectionsHelper.releaseConnection(connection);
    let unproccessedEmails = await bulkRegister(emailIds);//emailIds //


    //Starts proccessing the emails asynchronously
    proccessEmailsAsync(unproccessedEmails);



    return unproccessedEmails;

}

/**
 * @description - fetches the emails and inserts their information (subject, date, header, etc..) into the db
 * //TODO: (Somehow) Continue in case the process gets interrupted
 */
async function proccessEmailsAsync(unproccessedEmails) {
    console.log("Started email proccessing async");
    const connection = await connectionsHelper.getConnection('juansb827@gmail.com');

    const uids = unproccessedEmails.map(mailInfo => mailInfo.uid);
    //to retrieve email PK with its uid
    const pkByUid = {};
    unproccessedEmails.forEach(mailInfo => {
        pkByUid[mailInfo.uid] = mailInfo.id;
    });

    EmailHelper.fetchEmails(connection, uids)
        .on('message', message => {

            //console.log('Fetched message ', message.uid);            
            const _msg = {
                from: message.info.from,
                subject: message.info.subject,
                date: message.info.date,
                proccessed: true,
                processingState: 'INFO',
                attachments: message.attachments.length,
            }


            if (message.attachments.length === 0) {
                _msg.processingState = 'DONE';
                _msg.attachmentsState = 'DONE';
                _msg.matchingAttachments = 0;

                return Email.update(_msg, {
                    where: { uid: '' + message.uid }
                });

            }
            //Registers the info of the email (and its attachments)
            //inside a transaction
            return sequelize.transaction(t => {
                let chain = Email.update(_msg, {
                    where: { uid: '' + message.uid },
                    transaction: t
                });
                
                message.attachments.forEach(attch => {
                    chain = chain.then(() => {
                            return Attachment.create({
                            emailId: pkByUid[message.uid],
                            partId: attch.partID,
                            name: attch.params.name,
                            size: attch.size,
                            encoding: attch.encoding
                        }, { transaction: t });
                    })
                    
                }) 

                return chain;
            })
                .then(result => {
                    console.log("TRANSACTION ENDED");
                })
                .catch(err => {
                    console.log("Transaction Failed", err);
                })
            //const filteredAttch = filterAttachments(message.attachments);




            if (1 == 1) return;
            //Starts async attachments proccessing                                  
            Email.update(_msg, {
                where: { uid: '' + message.uid }
            })
                .then(() => {
                    return processAttachmentsAsync(message.uid, message.attachments)
                })
                .then(processedCount => {
                    _msg.processingState = 'DONE';
                    _msg.attachmentsState = 'DONE';
                    _msg.matchingAttachments = processedCount;
                    return Email.update(_msg, {
                        where: { uid: 'ds' + message.uid }
                    })
                })
                .catch(err => {
                    //TODO: (Somehow) Retry failed emails
                    console.log('Error updating email info', err);
                });








        })
        .on('error', err => {
            console.log('Error fetching message info', err);
        })
        .on('end', () => {
            console.log("###Fetched all mails from inbox");
            //connection.end();
        })
}

/**
 * @description - fetches email attachments and processes them accordingly (e.g converts them .XML into Invoices)
 * @param uid - id of the email in the inbox
 * @param attachments - attachment parts
 */
async function processAttachmentsAsync(uid, attachments) {

    if (!uid || !attachments) {
        console.log('processAttachmentsAsync', 'Invalid Param');
    }


    async function process(attch) {
        const connection = await connectionsHelper.getConnection('juansb827@gmail.com');

        const attchStream = await EmailHelper.getAttachmentStream(uid, attch.partID, attch.encoding, connection);

        const fileName = 'Files/' + attch.params.name;
        var writeStream = fs.createWriteStream(fileName);

        writeStream.once('finish', () => {
            console.log('Wrote', fileName);
            connectionsHelper.releaseConnection(connection);
        });

        writeStream.on('error', (err) => {
            cb(err);
        })
        attchStream.pipe(writeStream);


    }
    let filtered = filterAttachments(attachments);

    return new Promise((resolve, reject) => {
        async.each(filtered, process, (err) => {
            if (err) {
                return reject(err);
            }
            resolve(filtered.length);
        });
    })




}

function filterAttachments(attachments) {
    return attachments.filter(part => {
        const name = part.params.name;
        if (!name) {
            return false;
        }

        const extention = name.slice(-4).toUpperCase();

        if (extention === '.XML'
            || extention === '.PDF') {
            return true;
        }

        return false;
    })
};

/**
 *  @description - inserts the id of the email (the id which comes from the inbox) into the db
 *  so we can keep track of what emails have been already proccessed  
 *  @param mailIds - list of ids to register in the Db
 *  @returns - the list of emails (only the ids uid) that were not already registered  in the db
 */
function bulkRegister(ids) {

    if (!ids || ids.length == 0) {
        return Promise.reject(new Error('Ids is empty'));
    }

    const batchId = crypto.randomBytes(16).toString('hex');

    const emails = ids.map(id => {
        return {
            uid: id,
            batchId: batchId
        }
    })



    return new Promise((resolve, reject) => {
        Email.bulkCreate(emails, { ignoreDuplicates: true })
            .then(() => {
                //bulkCreate doesnt return the uids so we have to do a query to find them
                return Email.findAll({
                    attributes: ['id', 'uid'],
                    where: { batchId: batchId }
                });

            })
            .then(createdEmails => {
                const emailIds = createdEmails.map(mail => {
                    return { id: mail.get('id'), uid: mail.get('uid') };
                });
                resolve(emailIds);

            })
            .catch(err => {
                reject(err);
            })
    })

}
/*
bulkRegister(['4324321332123s3','32131']).then(succ => {
    console.log('success', succ);
})
    .catch(err => {
        console.log("*************************", err);

    }) */

module.exports = {
    bulkRegister
}





