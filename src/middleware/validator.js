// Joi does not mutate its input: `.trim()`, `.default()` and every other coercion land in the
// returned `value`, which this used to discard. A schema saying `.trim()` then did nothing, and
// `.max(255)` was measured against a trimmed string while the untrimmed one reached the column.
// Assigning the converted value back is what makes a schema mean what it says, everywhere at once.
// `req.query` is a getter in Express 5 that parses the URL again on every read, so assigning to it
// is lost; the converted value is defined on the request instead.
const post = (schema) => {
      return (req, res, next) => {
            const { error, value } = schema.validate(req.body, { abortEarly: false });
            if (error) {
                  return res.status(400).json({
                        code: 400,
                        message: "Validation Error",
                        data: { details: error.details.map((detail) => detail.message) },
                  });
            }
            req.body = value;
            next();
      };
};

const get = (schema) => {
      return (req, res, next) => {
            const { error, value } = schema.validate(req.query, { abortEarly: false });
            if (error) {
                  return res.status(400).json({
                        code: 400,
                        message: "Validation Error",
                        data: { details: error.details.map((detail) => detail.message) },
                  });
            }
            Object.defineProperty(req, "query", { value, writable: true, configurable: true, enumerable: true });
            next();
      };
};

// Path parameters. Without this a bad :oid reached the query and came back as a 500, which reads
// as "the server is broken" rather than "that is not an id".
const params = (schema) => {
      return (req, res, next) => {
            const { error } = schema.validate(req.params, { abortEarly: false });
            if (error) {
                  return res.status(400).json({
                        code: 400,
                        message: "Validation Error",
                        data: { details: error.details.map((detail) => detail.message) },
                  });
            }
            next();
      };
};

module.exports = {
      validator: {
            get: get,
            post: post,
            params: params,
      },
};
