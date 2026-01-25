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

/**
 * Generate human-readable label from field name
 * Handles common conventions: snake_case, _oid suffix, has_ prefix
 * @param {string} fieldName - Field name to convert
 * @returns {string} - Human-readable label
 */
const generateFieldLabel = (fieldName) => {
      let label = fieldName;
      
      // Remove _oid suffix (e.g., warehouse_oid -> warehouse)
      label = label.replace(/_oid$/i, '');
      
      // Split by underscores and capitalize each word
      label = label.split('_')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');
      
      return label;
};

/**
 * Detect changes between old and new objects and generate descriptive text
 * Automatically loops through all fields and generates labels from field names
 * @param {Object} oldData - Previous state of the object
 * @param {Object} newData - New state of the object (can be full object or partial updates)
 * @param {Object} fieldLabels - Custom human-readable labels for specific fields (optional)
 * @returns {Array<string>} - Array of change descriptions
 */
const detectChanges = (oldData, newData, fieldLabels = {}) => {
      const changes = [];
      
      if (!oldData || !newData) {
            return changes;
      }

      // System fields to skip
      const skipFields = ['oid', 'created_by', 'created_on', 'edited_by', 'edited_on'];

      // Automatically loop through all fields in newData
      for (const field in newData) {
            if (!newData.hasOwnProperty(field)) continue;
            
            // Skip if field doesn't exist in oldData (new field)
            if (!oldData.hasOwnProperty(field)) continue;
            
            // Skip system fields
            if (skipFields.includes(field)) continue;
            
            const oldValue = oldData[field];
            const newValue = newData[field];
            
            // Skip if values are the same
            if (oldValue === newValue) continue;
            
            // Use custom label if provided, otherwise auto-generate
            const fieldLabel = fieldLabels[field] || generateFieldLabel(field);
            
            // Handle null/empty values
            const oldDisplay = oldValue === null || oldValue === '' ? 'empty' : `"${oldValue}"`;
            const newDisplay = newValue === null || newValue === '' ? 'empty' : `"${newValue}"`;
            
            changes.push(`${fieldLabel} changed from ${oldDisplay} to ${newDisplay}`);
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
      generateFieldLabel
};
