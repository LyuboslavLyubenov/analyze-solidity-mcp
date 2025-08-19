const parser = require('@solidity-parser/parser');
const fs = require('fs');

// Helper function to extract source code for a function or modifier by name
function extractFunctionSource(fnName, sourceCode, loc, isModifier = false) {
    if (!fnName) return null;
    
    const lines = sourceCode.split('\n');

    // Handle fallback function specially
    if (fnName === '<fallback>') {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes('function()') || lines[i].includes('function ()')) {
                return extractFunctionBody(lines, i);
            }
        }
        return null;
    }
    
    const escapedFnName = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const keyword = isModifier ? 'modifier' : 'function';
    
    // Fallback to pattern matching if line numbers don't work
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(`${keyword} ${escapedFnName}`)) {
            return extractFunctionBody(lines, i);
        }
    }
    
    return null;
}

// Helper function to extract the full function body
function extractFunctionBody(lines, startLineIndex) {
    let functionLines = [];
    let braceCount = 0;
    let started = false;
    
    for (let i = startLineIndex; i < lines.length; i++) {
        const line = lines[i];
        functionLines.push(line);
        
        // Count braces
        for (let j = 0; j < line.length; j++) {
            if (line[j] === '{') {
                braceCount++;
                started = true;
            } else if (line[j] === '}') {
                braceCount--;
            }
        }
        
        // If we've started and brace count is back to 0, we've found the end
        if (started && braceCount === 0) {
            break;
        }
    }
    
    return functionLines.join('\n').trim();
}

// Helper function to recursively find all modifier definitions
function findModifierDefinitions(node, modifiers = {}, sourceCode) {
    if (!node) return modifiers;

    if (node.type === 'ModifierDefinition') {
        const modName = node.name;
        modifiers[modName] = {
            name: modName,
            parameters: node.parameters ? node.parameters.map(p => p.name) : [],
            source: extractFunctionSource(modName, sourceCode, node.loc, true)
        };
    }

    // Recursively search in subNodes
    if (node.subNodes) {
        node.subNodes.forEach(subNode => findModifierDefinitions(subNode, modifiers, sourceCode));
    }

    return modifiers;
}

// Helper function to recursively find all variable declarations for contract instances
function findContractInstances(node, instances = {}) {
    if (!node) return instances;

    // Look for state variables that are contract instances
    if (node.type === 'StateVariableDeclaration') {
        node.variables.forEach(variable => {
            if (variable.typeName && variable.typeName.type === 'UserDefinedTypeName') {
                instances[variable.name] = variable.typeName.namePath;
            }
        });
    }

    // Recursively search in subNodes
    if (node.subNodes) {
        node.subNodes.forEach(subNode => findContractInstances(subNode, instances));
    }

    return instances;
}

// Helper function to recursively find all function definitions
function findFunctionDefinitions(node, functions = {}, sourceCode) {
    if (!node) return functions;

    if (node.type === 'FunctionDefinition') {
        const fnName = node.name || '<fallback>';
        functions[fnName] = {
            name: fnName,
            parameters: node.parameters.map(p => p.name),
            modifiers: node.modifiers ? node.modifiers.map(m => ({
                name: m.name,
                parameters: m.parameters ? extractParameters({ arguments: m.parameters }) : []
            })) : [],
            source: extractFunctionSource(fnName, sourceCode, node.loc),
            calls: []
        };
    }

    // Recursively search in subNodes
    if (node.subNodes) {
        node.subNodes.forEach(subNode => findFunctionDefinitions(subNode, functions, sourceCode));
    }

    return functions;
}

// Helper function to extract parameter information from a function call
function extractParameters(node) {
    if (!node || !node.arguments) return [];
    
    return node.arguments.map(arg => {
        if (arg.type === 'Identifier') {
            return arg.name;
        } else if (arg.type === 'NumberLiteral') {
            return arg.number;
        } else if (arg.type === 'StringLiteral') {
            return `"${arg.value}"`;
        } else if (arg.type === 'MemberAccess') {
            return `${arg.expression.name}.${arg.memberName}`;
        } else if (arg.type === 'FunctionCall') {
            // Handle nested function calls recursively
            if (arg.expression && arg.expression.type === 'Identifier') {
                const nestedParams = extractParameters(arg);
                const paramsStr = nestedParams.length > 0 ? `(${nestedParams.join(', ')})` : '()';
                return `${arg.expression.name}${paramsStr}`;
            } else {
                return '<FunctionCall>';
            }
        } else if (arg.type === 'BinaryOperation') {
            // Handle binary operations (e.g., a + b)
            const left = extractParameterValue(arg.left);
            const right = extractParameterValue(arg.right);
            return `${left} ${arg.operator} ${right}`;
        } else if (arg.type === 'UnaryOperation') {
            const operand = extractParameterValue(arg.subExpression);
            return `${arg.operator}${operand}`;
        } else {
            return `<${arg.type}>`;
        }
    });
}

// Helper function to extract a single parameter value
function extractParameterValue(node) {
    if (!node) return '<unknown>';
    
    if (node.type === 'Identifier') {
        return node.name;
    } else if (node.type === 'NumberLiteral') {
        return node.number;
    } else if (node.type === 'StringLiteral') {
        return `"${node.value}"`;
    } else if (node.type === 'MemberAccess') {
        return `${node.expression.name}.${node.memberName}`;
    } else if (node.type === 'FunctionCall') {
        if (node.expression && node.expression.type === 'Identifier') {
            const nestedParams = extractParameters(node);
            const paramsStr = nestedParams.length > 0 ? `(${nestedParams.join(', ')})` : '()';
            return `${node.expression.name}${paramsStr}`;
        } else {
            return '<FunctionCall>';
        }
    } else if (node.type === 'UnaryOperation') {
        const operand = extractParameterValue(node.subExpression);
        return `${node.operator}${operand}`;
    } else {
        return `<${node.type}>`;
    }
}

// Helper function to deeply analyze function calls and create nested structure
function analyzeFunctionBodyNested(functionNode, functions, instances, sourceCode, analyzedFunctions = new Set(), callStack = [], functionNodes = {}) {
    if (!functionNode || !functionNode.body) return [];

    const currentFunctionName = functionNode.name || '<fallback>';
    
    // Prevent infinite recursion
    if (analyzedFunctions.has(currentFunctionName) || callStack.includes(currentFunctionName)) return [];
    
    const localAnalyzed = new Set([...analyzedFunctions]);
    localAnalyzed.add(currentFunctionName);
    
    const newCallStack = [...callStack, currentFunctionName];
    
    // Keep track of variable assignments in the current scope
    const variableAssignments = {};
    const directCalls = [];

    // Recursive function to traverse the function body
    function traverse(node, depth = 0) {
        if (!node) return;

        // Check for variable declarations with initial values
        if (node.type === 'VariableDeclarationStatement' && node.initialValue) {
            // Check if this is assigning the result of getTroveManager(index) to a variable
            if (node.initialValue.type === 'FunctionCall' && 
                node.initialValue.expression && 
                node.initialValue.expression.type === 'Identifier' && 
                node.initialValue.expression.name === 'getTroveManager') {
                
                // Get the variable name (assuming single variable declaration)
                let variableName = null;
                if (node.variables && node.variables.length > 0) {
                    const variable = node.variables[0];
                    if (variable && variable.name) {
                        variableName = variable.name;
                    }
                }
                
                if (variableName) {
                    variableAssignments[variableName] = {
                        instance: 'getTroveManager()',
                        contractType: 'ITroveManager'
                    };
                }
            }
        }

        // Check for function calls on variables that were assigned from getTroveManager
        if (node.type === 'FunctionCall' && node.expression) {
            const expression = node.expression;

            // Check for internal function calls (direct function calls)
            if (expression.type === 'Identifier') {
                const functionName = expression.name;
                if (functions[functionName]) {
                    const callInfo = {
                        type: 'internal',
                        target: functionName,
                        parameters: extractParameters(node),
                        source: extractFunctionSource(functionName, sourceCode, undefined),
                        calls: [] // Initialize empty calls array for nested calls
                    };
                    
                    // Recursively analyze the called internal function and get its nested calls
                    const calledFunctionNode = findFunctionNodeByName(functionName, functionNodes);
                    if (calledFunctionNode && !newCallStack.includes(functionName)) {
                        const nestedCalls = analyzeFunctionBodyNested(calledFunctionNode, functions, instances, sourceCode, localAnalyzed, newCallStack, functionNodes);
                        callInfo.calls = nestedCalls;
                    }
                    
                    directCalls.push(callInfo);
                }
            }

            // Check for external function calls on contract instances and library calls
            if (expression.type === 'MemberAccess') {
                // Case 1: Direct call on contract instance variable
                // e.g., boldToken.totalSupply()
                if (expression.expression.type === 'Identifier') {
                    const contractInstance = expression.expression.name;
                    const methodName = expression.memberName;

                    // Check if it's a library call (typically libraries are imported and called directly)
                    // Libraries are usually capitalized and not in instances
                    const isLibraryCall = !instances[contractInstance] && 
                                        contractInstance.charAt(0) === contractInstance.charAt(0).toUpperCase();

                    if (isLibraryCall) {
                        directCalls.push({
                            type: 'library',
                            library: contractInstance,
                            method: methodName,
                            parameters: extractParameters(node),
                            calls: [] // External calls don't have nested calls
                        });
                    } else if (instances[contractInstance]) {
                        directCalls.push({
                            type: 'external',
                            instance: contractInstance,
                            contractType: instances[contractInstance],
                            method: methodName,
                            parameters: extractParameters(node),
                            calls: [] // External calls don't have nested calls
                        });
                    }
                    
                    // Case 2: Call on variable that was assigned from getTroveManager
                    if (variableAssignments[contractInstance]) {
                        directCalls.push({
                            type: 'external',
                            instance: variableAssignments[contractInstance].instance,
                            contractType: variableAssignments[contractInstance].contractType,
                            method: methodName,
                            parameters: extractParameters(node),
                            calls: [] // External calls don't have nested calls
                        });
                    }
                }
                
                // Case 2: Handle chained library calls like: SafeMath.add().mul()
                else if (expression.expression.type === 'MemberAccess') {
                    let currentExpr = expression.expression;
                    const callChain = [expression.memberName];
                    
                    // Walk up the chain
                    while (currentExpr && currentExpr.type === 'MemberAccess') {
                        callChain.unshift(currentExpr.memberName);
                        currentExpr = currentExpr.expression;
                    }
                    
                    if (currentExpr && currentExpr.type === 'Identifier') {
                        const rootLibrary = currentExpr.name;
                        const isLibraryCall = rootLibrary.charAt(0) === rootLibrary.charAt(0).toUpperCase();
                        
                        if (isLibraryCall) {
                            directCalls.push({
                                type: 'library',
                                library: rootLibrary,
                                method: callChain.join('.'),
                                parameters: extractParameters(node),
                                calls: [] // External calls don't have nested calls
                            });
                        }
                    }
                }
            }
        }

        // Recursively traverse all properties of the node
        for (const key in node) {
            if (node[key] && typeof node[key] === 'object' && key !== 'parent') {
                if (Array.isArray(node[key])) {
                    node[key].forEach(child => traverse(child, depth + 2));
                } else if (node[key].type) {
                    traverse(node[key], depth + 2);
                }
            }
        }
    }

    // Start traversing from the function body
    traverse(functionNode.body, 0);
    
    return directCalls;
}

// Helper function to analyze function calls within a specific function (backward compatibility)
function analyzeFunctionBody(functionNode, functions, instances, sourceCode, functionNodes) {
    const calls = analyzeFunctionBodyNested(functionNode, functions, instances, sourceCode, new Set(), [], functionNodes);
    const functionName = functionNode.name || '<fallback>';
    if (functions[functionName]) {
        functions[functionName].calls = calls;
    }
}

// Helper function to find a function node by name
function findFunctionNodeByName(functionName, functionNodes) {
    return functionNodes[functionName];
}

// Collect all function nodes first
function collectFunctionNodes(node, functionNodes = {}) {
    if (!node) return functionNodes;

    if (node.type === 'FunctionDefinition') {
        const fnName = node.name || '<fallback>';
        functionNodes[fnName] = node;
    }

    // Recursively search in subNodes
    if (node.subNodes) {
        node.subNodes.forEach(subNode => collectFunctionNodes(subNode, functionNodes));
    }
    
    return functionNodes;
}

// Analyze each function's body for calls
function analyzeAllFunctionBodies(node, functionDefinitions, contractInstances, sourceCode, functionNodes) {
    if (!node) return;

    if (node.type === 'FunctionDefinition') {
        analyzeFunctionBody(node, functionDefinitions, contractInstances, sourceCode, functionNodes);
    }

    // Recursively search in subNodes
    if (node.subNodes) {
        node.subNodes.forEach(subNode => analyzeAllFunctionBodies(subNode, functionDefinitions, contractInstances, sourceCode, functionNodes));
    }
}

// Main function to analyze Solidity contract
function analyzeSolidityContract(filePath, filterFunctions = null) {
    // Read the Solidity file
    const input = fs.readFileSync(filePath).toString('utf8');

    // Parse the Solidity code into an AST
    const ast = parser.parse(input);

    // Extract import directives
    const imports = ast.children.filter(a => a.type === 'ImportDirective');

    // Extract the main contract definition
    const contract = ast.children.find(a => a.type === 'ContractDefinition');

    // Find contract instances in the contract
    const contractInstances = findContractInstances(contract);

    // Find modifier definitions in the contract
    const modifierDefinitions = findModifierDefinitions(contract, {}, input);

    // Store function nodes for later reference
    const functionNodes = collectFunctionNodes(contract);

    // Find function definitions in the contract
    const functionDefinitions = findFunctionDefinitions(contract, {}, input);

    // Analyze each function's body for calls
    analyzeAllFunctionBodies(contract, functionDefinitions, contractInstances, input, functionNodes);

    // Filter functions if specified
    const filteredFunctions = filterFunctions 
        ? Object.fromEntries(
            Object.entries(functionDefinitions)
                .filter(([name]) => filterFunctions.includes(name)))
        : functionDefinitions;

    // Store connections in memory
    const connections = {
        imports: imports.map(i => i.path),
        contractInstances: contractInstances,
        modifiers: modifierDefinitions,
        functions: filteredFunctions
    };

    return connections;
}

module.exports = {
    analyzeSolidityContract
};