const post = (schema) => {
      return (req, res, next) => {
            const { error } = schema.validate(req.body, { abortEarly: false });
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

const get = (schema) => {
      return (req, res, next) => {
            const { error } = schema.validate(req.query, { abortEarly: false });
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
