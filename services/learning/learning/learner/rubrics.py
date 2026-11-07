from pydantic import BaseModel, Field
from typing import List, Optional
import logging
from learning.models.gateway import ModelGateway
from learning.models.routing import ModelTask

logger = logging.getLogger(__name__)

class RubricCriterion(BaseModel):
    """What constitutes genuine understanding for a specific competency."""
    criterion_id: str
    description: str
    weight: float = 1.0
    requires_reasoning: bool = True

class ReasoningAssessment(BaseModel):
    """Model-evaluated assessment of learner reasoning quality."""
    quality: str  # 'shallow', 'partial', 'deep', 'incorrect', 'off_topic', 'unassessed'
    demonstrated: bool = False
    evidence_gaps: List[str] = Field(default_factory=list)
    matched_criteria: List[str] = Field(default_factory=list)
    confidence: float = 0.5
    rationale: str

class ActivityRubric(BaseModel):
    competency_key: str
    criteria: List[RubricCriterion]
    minimum_for_demonstrated: int = 2

DEFAULT_RUBRICS = {
    "dsa.two_pointers.inward_convergence": ActivityRubric(
        competency_key="dsa.two_pointers.inward_convergence",
        criteria=[
            RubricCriterion(criterion_id="independent_invariant", description="Explains how moving pointers inward reduces the search space based on the sorted property."),
            RubricCriterion(criterion_id="left_pointer_increase", description="Explains that advancing the left pointer increases the sum."),
            RubricCriterion(criterion_id="right_pointer_decrease", description="Explains that decreasing the right pointer decreases the sum.")
        ],
        minimum_for_demonstrated=2
    ),
    "cs.memory.heap_stack": ActivityRubric(
        competency_key="cs.memory.heap_stack",
        criteria=[
            RubricCriterion(criterion_id="heap_per_process", description="Explains that the heap is isolated per process and not shared across the entire system."),
            RubricCriterion(criterion_id="stack_per_thread", description="Explains that the stack is isolated per thread.")
        ],
        minimum_for_demonstrated=1
    ),
    "cs.concurrency.race_conditions": ActivityRubric(
        competency_key="cs.concurrency.race_conditions",
        criteria=[
            RubricCriterion(criterion_id="race_condition_timing", description="Explains that race conditions occur due to timing or unpredictable interleaving of threads."),
            RubricCriterion(criterion_id="critical_section_protection", description="Explains that a critical section needs to be protected, typically with a mutex or lock.")
        ],
        minimum_for_demonstrated=2
    ),
    "ml.regression.gradient_descent": ActivityRubric(
        competency_key="ml.regression.gradient_descent",
        criteria=[
            RubricCriterion(criterion_id="loss_minimization", description="Explains that gradient descent iteratively adjusts parameters to minimize the loss function."),
            RubricCriterion(criterion_id="gradient_direction", description="Explains that parameters are updated in the opposite direction of the gradient.")
        ],
        minimum_for_demonstrated=2
    )
}

def get_rubric_for_competency(competency_key: str) -> Optional[ActivityRubric]:
    return DEFAULT_RUBRICS.get(competency_key)

def assess_against_rubric(
    learner_answer: str,
    rubric: ActivityRubric,
    context: Optional[str] = None,
    owner_id: Optional[str] = None,
) -> ReasoningAssessment:
    gateway = ModelGateway()
    
    prompt = f"Evaluate the following learner answer against the rubric.\n"
    if context:
        prompt += f"Context: {context}\n"
    prompt += f"Learner Answer: {learner_answer}\n"
    prompt += "Rubric Criteria:\n"
    for c in rubric.criteria:
        prompt += f"- [{c.criterion_id}] {c.description}\n"
    prompt += "\nOutput a JSON conforming to the requested schema. 'quality' should be one of: shallow, partial, deep, incorrect, off_topic."

    try:
        assessment, _ = gateway.generate_structured(
            prompt=prompt,
            response_schema=ReasoningAssessment,
            role="tutor",
            pool="live_learning",
            task=ModelTask.LESSON_ASSESSMENT,
            owner_id=owner_id,
        )
        return assessment
    except Exception as e:
        logger.warning(f"Model assessment failed: {e}")
        return ReasoningAssessment(
            quality="unassessed",
            demonstrated=False,
            evidence_gaps=[],
            matched_criteria=[],
            confidence=0.0,
            rationale=f"Model unavailable or failed: {str(e)}"
        )
