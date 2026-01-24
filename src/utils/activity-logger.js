const { TABLE } = require("./constant");
const { get_data } = require("./database");
const { v4: uuidv4 } = require('uuid');
const { log } = require("./log");

/**
 * Log an activity to the activity_log table (NON-BLOCKING)
 * This function fires and forgets - does not block the main operation
 * @param {Object} params - Activity parameters
 * @param {string} params.reference_type - Type of entity (category, product, etc.)
 * @param {string} params.reference_oid - OID of the entity
 * @param {string} params.title - title performed
 * @param {string} [params.description] - Optional description
 * @param {string} params.performed_by - Email of user who performed the action
 */
const saveLogActivity = ({ reference_type, reference_oid, title, performed_by, description = null }) => {
      // Fire and forget - do not wait for this operation
      setImmediate(async () => {
            try {
                  const oid = uuidv4();
                  const query = `
                        INSERT INTO ${TABLE.ACTIVITY_LOG} 
                        (oid, reference_type, reference_oid, title, description, performed_by)
                        VALUES ($1, $2, $3, $4, $5, $6)
                  `;
                  
                  const values = [
                        oid,
                        reference_type,
                        reference_oid,
                        title,
                        description,
                        performed_by
                  ];

                  await get_data({ text: query, values });
                  log.info(`Activity logged: ${title} on ${reference_type} by ${performed_by}`);
            } catch (error) {
                  log.error(`Failed to log activity: ${error?.message}`);
                  // Don't throw error - activity logging should not break the main flow
            }
      });
};

/**Detect changes between old and new objects and generate descriptive text
 * @param {Object} oldData - Previous state of the object
 * @param {Object} newData - New state of the object
 * @param {Object} fieldLabels - Human-readable labels for fields (optional)
 * @returns {Array<string>} - Array of change descriptions
 */
const detectChanges = (oldData, newData, fieldLabels = {}) => {
      const changes = [];
      
      if (!oldData) {
            return changes;
      }

      // Define default field labels
      const labels = {
            name: 'Name',
            description: 'Description',
            status: 'Status',
            category_code: 'Category Code',
            email: 'Email',
            phone_number: 'Phone Number',
            address: 'Address',
            price: 'Price',
            quantity: 'Quantity',
            ...fieldLabels
      };

      // Check each field in newData
      for (const field in newData) {
            if (newData.hasOwnProperty(field) && oldData.hasOwnProperty(field)) {
                  const oldValue = oldData[field];
                  const newValue = newData[field];
                  
                  // Skip if values are the same
                  if (oldValue === newValue) {
                        continue;
                  }
                  
                  // Skip system fields
                  if (['oid', 'created_by', 'created_on', 'edited_by', 'edited_on'].includes(field)) {
                        continue;
                  }
                  
                  const fieldLabel = labels[field] || field.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                  
                  // Handle null/empty values
                  const oldDisplay = oldValue === null || oldValue === '' ? 'empty' : `"${oldValue}"`;
                  const newDisplay = newValue === null || newValue === '' ? 'empty' : `"${newValue}"`;
                  
                  changes.push(`${fieldLabel} changed from ${oldDisplay} to ${newDisplay}`);
            }
      }

      return changes;
};

/**
 * Generate a descriptive activity message based on detected changes
 * @param {string} entityName - Name of the entity (e.g., category name)
 * @param {Array<string>} changes - Array of change descriptions
 * @returns {string} - Formatted description
 */
const generateChangeDescription = (entityName, changes) => {
      if (changes.length === 0) {
            return `Updated ${entityName}`;
      }
      
      if (changes.length === 1) {
            return changes[0];
      }
      
      // Multiple changes
      if (changes.length <= 3) {
            return changes.join(', ');
      }
      
      // Too many changes, summarize
      return `Updated ${changes.length} fields: ${changes.slice(0, 2).join(', ')}, and ${changes.length - 2} more`;
};

/**
 * Get activities for a specific entity
 * @param {string} reference_type - Type of entity
 * @param {string} reference_oid - OID of the entity
 * @param {number} [limit=10] - Number of activities to fetch
 * @returns {Promise<Array>} - Array of activities
 */
const getLogActivities = async (reference_type, reference_oid, limit = 10) => {
      try {
            const query = `
                  SELECT 
                        oid,
                        reference_oid,
                        reference_type,
                        title,
                        description,
                        performed_by,
                        TO_CHAR(performed_on, 'YYYY-MM-DD"T"HH24:MI:SS.MS') as performed_on
                  FROM ${TABLE.ACTIVITY_LOG}
                  WHERE reference_type = $1 AND reference_oid = $2
                  ORDER BY performed_on DESC
                  LIMIT $3
            `;
            
            const result = await get_data({ text: query, values: [reference_type, reference_oid, limit] });
            return result;
      } catch (error) {
            log.error(`Failed to get activities: ${error?.message}`);
            return [];
      }
};

module.exports = {
      saveLogActivity,
      getLogActivities,
      detectChanges,
      generateChangeDescription,
      getLogActivities
};
