/*!
 * ${copyright}
 */

//Provides class sap.ui.model.odata.v4.lib._MetadataConverter
sap.ui.define([], function () {
	"use strict";

	var MetadataConverter,
		rCollection = /^Collection\((.*)\)$/,
		oAliasConfig = {
			"Reference" : {
				"Include" : {__processor : processAlias}
			},
			"DataServices" : {
				"Schema" : {__processor : processAlias}
			}
		},
		oStructuredTypeConfig = {
			"Property" : {
				__processor : processTypeProperty
			},
			"NavigationProperty" : {
				__processor : processTypeNavigationProperty,
				"OnDelete" : {
					__processor : processTypeNavigationPropertyOnDelete
				},
				"ReferentialConstraint" : {
					__processor : processTypeNavigationPropertyReferentialConstraint
				}
			}
		},
		oEntitySetConfig = {
			"NavigationPropertyBinding" : {
				__processor : processNavigationPropertyBinding
			}
		},
		oFullConfig = {
			"Reference" : {
				__processor : processReference,
				"Include" : {
					__processor: processInclude
				}
			},
			"DataServices" : {
				"Schema" : {
					__processor : processSchema,
					"EntityType" : {
						__processor : processEntityType,
						__include : oStructuredTypeConfig,
						"Key" : {
							"PropertyRef" : {
								__processor : processEntityTypeKeyPropertyRef
							}
						}
					},
					"ComplexType" : {
						__processor : processComplexType,
						__include : oStructuredTypeConfig
					},
					"EntityContainer" : {
						__processor : processEntityContainer,
						"EntitySet" : {
							__processor : processEntitySet,
							__include : oEntitySetConfig
						},
						"Singleton" : {
							__processor : processSingleton,
							__include : oEntitySetConfig
						}
					},
					"EnumType" : {
						__processor : processEnumType,
						"Member" : {
							__processor : processEnumTypeMember
						}
					}
				}
			}
		};

	/**
	 * Returns the attributes of the DOM Element as map.
	 *
	 * @param {Element}
	 *            oElement the element
	 * @returns {object} the attributes
	 */
	function getAttributes(oElement) {
		var oAttribute, oAttributeList = oElement.attributes, i, oResult = {};

		for (i = 0; i < oAttributeList.length; i++) {
			oAttribute = oAttributeList.item(i);
			oResult[oAttribute.name] = oAttribute.value;
		}
		return oResult;
	}

	/**
	 * Extracts the Aliases from the Include and Schema elements.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processAlias(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement);

		if (oAttributes.Alias) {
			oAggregate.aliases[oAttributes.Alias] = oAttributes.Namespace;
		}
	}

	/**
	 * Copies all attributes from oAttributes to oTarget according to oConfig.
	 * @param {object} oAttributes the attribute of an Element as returned by getAttributes
	 * @param {object} oTarget the target object
	 * @param {object} oConfig
	 *   the configuration: each property describes a property of oAttributes to copy; the value is
	 *   a conversion function, if this function returns undefined, the property is not set
	 */
	function processAttributes(oAttributes, oTarget, oConfig) {
		Object.keys(oConfig).forEach(function (sProperty) {
			var sValue = oConfig[sProperty](oAttributes[sProperty]);
			if (sValue !== undefined) {
				oTarget["$" + sProperty] = sValue;
			}
		});
	}

	/**
	 * Processes a ComplexType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processComplexType(oElement, oAggregate) {
		processType(oElement, oAggregate, {"$kind" : "ComplexType"});
	}

	/**
	 * Processes an EntityContainer element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntityContainer(oElement, oAggregate) {
		var sQualifiedName = oAggregate.namespace + "." + oElement.getAttribute("Name");
		oAggregate.result[sQualifiedName] = oAggregate.entityContainer = {
			"$kind" : "EntityContainer"
		};
		oAggregate.result.$EntityContainer = sQualifiedName;
	}

	/**
	 * Processes an EntitySet element at the EntityContainer.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntitySet(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement);
		oAggregate.entityContainer[oAttributes.Name] = oAggregate.entitySet = {
			$Type : MetadataConverter.resolveAlias(oAttributes.EntityType, oAggregate)
		};
		if (oAttributes.IncludeInServiceDocument === "false") {
			oAggregate.entitySet.$IncludeInServiceDocument = false;
		}
	}

	/**
	 * Processes an EntityType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntityType(oElement, oAggregate) {
		processType(oElement, oAggregate, {$Key : []});
	}

	/**
	 * Processes a PropertyRef element of the EntityType's Key.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEntityTypeKeyPropertyRef(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			vKey;

		if (oAttributes.Alias) {
			vKey = {};
			vKey[oAttributes.Alias] = oAttributes.Name;
		} else {
			vKey = oAttributes.Name;
		}
		oAggregate.type.$Key = oAggregate.type.$Key.concat(vKey);
	}

	/**
	 * Processes an EnumType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEnumType(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name,
			oEnumType = {
				"$kind": "EnumType"
			};

		processAttributes(oAttributes, oEnumType, {
			"IsFlags" : setIfTrue,
			"UnderlyingType" : function (sValue) {
				return sValue !== "Edm.Int32" ? sValue : undefined;
			}
		});

		oAggregate.result[sQualifiedName] = oAggregate.enumType = oEnumType;
		oAggregate.enumTypeMemberCounter = 0;
	}

	/**
	 * Processes an Member element within a EnumType.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processEnumTypeMember(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			sValue = oAttributes.Value,
			vValue;

		if (sValue) {
			vValue = parseInt(sValue, 10);
			if (sValue !== "" + vValue) {
				vValue = sValue;
			}
		} else {
			vValue = oAggregate.enumTypeMemberCounter;
			oAggregate.enumTypeMemberCounter++;
		}
		oAggregate.enumType[oAttributes.Name] = vValue;
	}

	/**
	 * Processes an Include element within a Reference.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processInclude(oElement, oAggregate) {
		oAggregate.result[oElement.getAttribute("Namespace")] = {
			"$kind" : "Reference",
			"$ref" : oAggregate.referenceUri
		};
	}

	/**
	 * Processes a NavigationPropertyBinding element within an EntitySet or Singleton.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processNavigationPropertyBinding(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oNavigationPropertyBinding = oAggregate.entitySet.$NavigationPropertyBinding;

		if (!oNavigationPropertyBinding) {
			oAggregate.entitySet.$NavigationPropertyBinding = oNavigationPropertyBinding = {};
		}
		oNavigationPropertyBinding[oAttributes.Path]
			= MetadataConverter.resolveAlias(oAttributes.Target, oAggregate);
	}

	/**
	 * Processes a Reference element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processReference(oElement, oAggregate) {
		oAggregate.referenceUri = oElement.getAttribute("Uri");
	}

	/**
	 * Processes a Schema element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processSchema(oElement, oAggregate) {
		oAggregate.namespace = oElement.getAttribute("Namespace");
	}

	/**
	 * Processes a Singleton element at the EntityContainer.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processSingleton(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement);
		oAggregate.entityContainer[oAttributes.Name] = oAggregate.entitySet = {
			$kind : "Singleton",
			$Type : MetadataConverter.resolveAlias(oAttributes.Type, oAggregate)
		};
	}

	/**
	 * Processes a ComplexType or EntityType element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 * @param {object} oType the initial typed result object
	 */
	function processType(oElement, oAggregate, oType) {
		var oAttributes = getAttributes(oElement),
			sQualifiedName = oAggregate.namespace + "." + oAttributes.Name;

		processAttributes(oAttributes, oType, {
			"OpenType" : setIfTrue,
			"HasStream" : setIfTrue,
			"Abstract" : setIfTrue,
			"BaseType" : setValue
		});

		oAggregate.result[sQualifiedName] = oAggregate.type = oType;
	}

	/**
	 * Processes the type in the form "Type" or "Collection(Type)" and sets the appropriate
	 * properties.
	 * @param {string} sType the type attribute from the Element
	 * @param {object} oProperty the property attribute in the JSON
	 * @param {object} oAggregate the aggregate
	 */
	function processTypedCollection(sType, oProperty, oAggregate) {
		var aMatches = rCollection.exec(sType);

		if (aMatches) {
			oProperty.$isCollection = true;
			sType = aMatches[1];
		}
		oProperty.$Type = MetadataConverter.resolveAlias(sType, oAggregate);
	}

	/**
	 * Processes a NavigationProperty element of a structured type.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeNavigationProperty(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oProperty = {
				$kind : "navigation"
			};

		processTypedCollection(oAttributes.Type, oProperty, oAggregate);
		processAttributes(oAttributes, oProperty, {
			"Nullable" : setIfFalse,
			"Partner" : setValue,
			"ContainsTarget" : setIfTrue
		});

		oAggregate.type[oAttributes.Name] = oAggregate.navigationProperty = oProperty;
	}

	/**
	 * Processes a NavigationProperty OnDelete element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeNavigationPropertyOnDelete(oElement, oAggregate) {
		oAggregate.navigationProperty.$OnDelete = oElement.getAttribute("Action");
	}

	/**
	 * Processes a NavigationProperty OnDelete element.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeNavigationPropertyReferentialConstraint(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oReferentialConstraint = oAggregate.navigationProperty.$ReferentialConstraint;

		if (!oReferentialConstraint) {
			oAggregate.navigationProperty.$ReferentialConstraint = oReferentialConstraint = {};
		}

		oReferentialConstraint[oAttributes.Property] = oAttributes.ReferencedProperty;
	}

	/**
	 * Processes a Property element of a structured type.
	 * @param {Element} oElement the element
	 * @param {object} oAggregate the aggregate
	 */
	function processTypeProperty(oElement, oAggregate) {
		var oAttributes = getAttributes(oElement),
			oProperty = {};

		processTypedCollection(oAttributes.Type, oProperty, oAggregate);
		processAttributes(oAttributes, oProperty, {
			"DefaultValue" : setValue,
			"Nullable" : setIfFalse,
			"MaxLength" : setNumber,
			"Precision" : setNumber,
			"Scale" : function (sValue) {
				return sValue === "variable" ? sValue : setNumber(sValue);
			},
			"SRID" : setValue,
			"Unicode" : setIfFalse
		});

		oAggregate.type[oAttributes.Name] = oProperty;
	}

	/**
	 * Helper for processAttributes, returns false if sValue is "false", returns undefined
	 * otherwise.
	 * @param {string} sValue the attribute value in the element
	 * @returns {boolean} false or undefined
	 */
	function setIfFalse(sValue) {
		return sValue === "false" ? false : undefined;
	}

	/**
	 * Helper for processAttributes, returns true if sValue is "true", returns undefined
	 * otherwise.
	 * @param {string} sValue the attribute value in the element
	 * @returns {boolean} true or undefined
	 */
	function setIfTrue(sValue) {
		return sValue === "true" ? true : undefined;
	}

	/**
	 * Helper for processAttributes, returns sValue converted to a number.
	 * @param {string} sValue the attribute value in the element
	 * @returns {number} the value as number or undefined
	 */
	function setNumber(sValue) {
		return sValue ? parseInt(sValue, 10) : undefined;
	}

	/**
	 * Helper for processAttributes, returns sValue.
	 * @param {string} sValue the attribute value in the element
	 * @returns {string} sValue
	 */
	function setValue(sValue) {
		return sValue;
	}

	MetadataConverter = {

		/**
		 * Converts the metadata from XML format to a JSON object.
		 *
		 * @param {Document} oDocument
		 *   the XML DOM document
		 * @returns {object}
		 *   the metadata JSON
		 */
		convertXMLMetadata : function (oDocument) {
			var oAggregate = {
					aliases : {}, // maps alias -> namespace
					entityContainer : null, // the current EntityContainer
					entitySet : null, // the current EntitySet/Singleton
					enumType : null, // the current EnumType
					enumTypeMemberCounter : 0, // the current EnumType member value counter
					namespace : null, // the namespace of the current Schema
					navigationProperty : null, // the current NavigationProperty
					referenceUri : null, // the URI of the current Reference
					type : null, // the current EntityType/ComplexType
					result : {}
				},
				oElement = oDocument.documentElement;

			// first round: find aliases
			MetadataConverter.traverse(oElement, oAggregate, oAliasConfig);
			// second round, full conversion
			MetadataConverter.traverse(oElement, oAggregate, oFullConfig);
			return oAggregate.result;
		},

		/**
		 * Resolves an alias in the given qualified name or full name.
		 * @param {string} sName the name
		 * @param {object} oAggregate the aggregate containing the aliases
		 * @returns {string} the name with the alias resolved (if there was one)
		 */
		resolveAlias : function (sName, oAggregate) {
			var iDot = sName.indexOf("."),
				sNamespace;

			if (sName.indexOf(".", iDot + 1) < 0) { // if there is no second dot
				sNamespace = oAggregate.aliases[sName.slice(0, iDot)];
				if (sNamespace) {
					return sNamespace + "." + sName.slice(iDot + 1);
				}
			}
			return sName;
		},

		/**
		 * Recursively traverses the subtree of a given xml element controlled by the given
		 * schema config.
		 *
		 * @param {Element} oElement
		 *   an XML DOM element
		 * @param {object} oAggregate
		 *   an aggregate object that is passed to every processor function
		 * @param {object} oSchemaConfig
		 *   the configuration for this element. The property __processor is a function called
		 *   with this element and oAggregate as parameters; all other properties are known
		 *   child elements, the value is the configuration for that child element
		 */
		traverse : function (oElement, oAggregate, oSchemaConfig) {
			var oChildList = oElement.childNodes,
				oChildNode, i, oNodeInfo;

			if (oSchemaConfig.__processor) {
				oSchemaConfig.__processor(oElement, oAggregate);
			}
			for (i = 0; i < oChildList.length; i++) {
				oChildNode = oChildList.item(i);
				if (oChildNode.nodeType === 1) { // Node.ELEMENT_NODE
					oNodeInfo = oSchemaConfig[oChildNode.localName];
					if (!oNodeInfo && oSchemaConfig.__include) {
						oNodeInfo = oSchemaConfig.__include[oChildNode.localName];
					}
					if (oNodeInfo) {
						MetadataConverter.traverse(oChildNode, oAggregate, oNodeInfo);
					}
				}
			}
		}
	};

	return MetadataConverter;
}, /* bExport= */false);
