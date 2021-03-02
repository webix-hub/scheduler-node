const cors = require("cors");
const express = require("express");
const bodyParser = require("body-parser");

const app = express();

app.use(cors());
// parsing application/json
app.use(bodyParser.json()); 
// parsing application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true })); 

const port = process.env.APP_PORT || 3000;
app.listen(port, function () {
	console.log("Server is running on port " + port + "...");
	console.log(`Open http://localhost:${port} in browser`);
});

const Datastore = require("nedb");

const db = new Datastore();
db.insert(require("./data.json"));

const cb = new Datastore();
cb.insert(require("./calendars.json"));

// client side expects obj.id while DB provides obj._id
function fixID(a){
	a.id = a._id;
	delete a._id;
	return a;
}

// Retrieves end of repetition for recurring events
function getEndRepeat(event) {
	// FREQ=DAILY;INTERVAL=2;UNTIL=20211023T000000Z;
	let endRepeat;

	const parts = event.recurring.split(";");
	for (let i = 0; i < parts.length; i++) {
		const [key, value] = parts[i].split("=");
		if (key === "UNTIL") endRepeat = strToDate(value);
	}

	return endRepeat;
}

// Converts date strings (20211023T000000Z) to Date objects
function strToDate(str) {
	return new Date(
		str.substr(0, 4) * 1,
		str.substr(4, 2) * 1 - 1,
		str.substr(6, 2) * 1
	);
}

app.get("/events", (req, res, next) => {
	const from = req.query.from;
	const to = req.query.to;

	if (from && to) {
		db.find({
			start_date:{ $lt: req.query.to },
			$or:[
				{ end_date:{ $gte: req.query.from } },
				{ $not: { recurring: "" } }
			]
		}).sort({ start_date: 1 }).exec((err, data) => {
			if (err)
			    next(err);
			else {
				const fromDate = new Date(from);
				data = data.filter(event => {
					if (event.recurring) {
						const end = getEndRepeat(event);
						return !end || end > fromDate;
					} else return true;
				});

				res.send(data.map(fixID));
			}
		});
	} else {
		db.find({}).sort({ start_date: 1 }).exec((err, data) => {
			if (err)
				next(err);
			else
				res.send(data.map(fixID));
		});
	}
});

const allowedFields = [
	"start_date",
	"end_date",
	"all_day",
	"text",
	"details",
	"color",
	"recurring",
	"calendar",
	"origin_id"
];

app.put("/events/:id", (req, res, next) => {
	const event = {};
	for (f in req.body){
		if (allowedFields.indexOf(f) !== -1) event[f] = req.body[f];
	}

	db.update({ _id: req.params.id }, { $set: event }, {}, (err, data) => {
		if (err)
			next(err);
		else {
			const mode = req.body.recurring_update_mode;
			if (mode === "all"){
				// remove all sub-events
				db.remove({ origin_id: req.params.id }, { multi: true }, (err, data) => {
					if (err)
						next(err);
					else
						res.send({});
				});
			} else if (mode === "next"){
				// remove all sub-events after new 'this and next' group
				const date = req.body.recurring_update_date;
				if (!date) {
					next("date must be provided");
				} else {
					// in case update came for a subevent, search the master event
					db.find({ _id: req.params.id, origin_id:{ $ne: "0" }}, (err, data) => {
						if (err){
							next(err);
						} else {
							let id = req.params.id;
							if (data.length){
								id = data[0].origin_id;
							}
							db.remove({ origin_id: id, start_date: { $gte: date }}, { multi: true }, (err, data) => {
								if (err)
									next(err);
								else
									res.send({});
							})
						}
					});
				}
			} else {
				res.send({});
			}
		}
	});
});

app.delete("/events/:id", (req, res, next) => {
	db.remove({ _id: req.params.id }, {}, (err, data) => {
		if (err)
			next(err);
		else {
			// remove all subevents
			db.remove({ origin_id: req.params.id }, { multi: true }, (err, data) => {
				if (err)
					next(err);
				else
					res.send({});
			});
		}
	});
});

app.post("/events", (req, res, next) => {
	db.insert(req.body, (err, data) => {
		if (err) 
			next(err);
		else
			res.send({ id: fixID(data).id });
	});
});

app.get("/calendars", (req, res, next) => {
	cb.find({}).sort({ order: 1 }).exec((err, data) => {
	if (err)
		next(err);
	else
		res.send(data.map(fixID));
	});
});

app.put("/calendars/:id", (req, res, next) => {
	cb.update({ _id: req.params.id }, { $set: req.body }, {}, (err, data) => {
		if (err)
			next(err);
		else
			res.send({});
	});
});

app.delete("/calendars/:id", (req, res, next) => {
	cb.remove({ _id: req.params.id }, {}, (err, data) => {
		if (err)
			next(err);
		else {
			// remove all events from that calendar
			db.remove({ calendar: req.params.id }, { multi: true }, (err, data) => {
				if (err)
					next(err);
				else 
					res.send({});
			});
		}
	});
});

app.post("/calendars", (req, res, next) => {
	cb.insert(req.body, (err, data) => {
		if (err) 
			next(err);
		else
			res.send({ id: fixID(data).id });
	});
});